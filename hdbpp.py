"""This module contains a convenient wrapper for asynchronously getting data
from a HDB++ cassandra database. It also provices a caching mechanism that
keeps recently used data in memory.

Some observations:

Read http://www.datastax.com/dev/blog/basic-rules-of-cassandra-data-modeling

Since data in Cassandra/HDB++ is stored with the day's date as part of
the partition key it's not efficient to make queries that reach across
several dates. Therefore we always split up larger queries into one
separate query per date and run these concurrently. This way we should
make optimal use of the distributed nature of cassandra. Note that
there are plans to change the partition size from date to date+hour in
HDB++, but this should be easy to adapt to.

Mostly in order to make caching easier, we'll always query and return
entire days (except in the special case of today's date). This means
that a very small request will be slower than necessary, but only the
first query.  Subsequently the whole day will be in the cache. This
might change in the future.

The handling of timestamps is messy, mostly I guess because cassandra
does not support microsecond resolution (only milliseconds). Therefore
the timestamps are split into "*_time" (which is a cassandra datetime
column with second precision) and "*_time_us" which is an integer that
contains the number of microseconds to add to the '*_time' column. But
only the "*_time" column can be filtered on.

get_attribute_data() always returns a future, which resolves to a pandas
dataframe containing the data.
"""

import asyncio
from collections import defaultdict
from dateutil import tz
import logging
import time
from datetime import date, timedelta, datetime

from cassandra.cluster import Cluster
from cassandra.protocol import NumpyProtocolHandler
from cassandra.policies import AddressTranslator
from cassandra import ConsistencyLevel
from cassandra.query import tuple_factory
from cassandra.connection import InvalidRequestException

import numpy as np
import pandas as pd

from utils import memoized_ttl, SizeLimitedCache, retry_future
from aiocassandra import aiosession


HDBPP_DATA_TYPES = [
    "scalar_devboolean_ro",
    "scalar_devboolean_rw",
    "scalar_devdouble_ro",
    "scalar_devdouble_rw",
    "scalar_devencoded_ro",
    "scalar_devencoded_rw",
    "scalar_devfloat_ro",
    "scalar_devfloat_rw",
    "scalar_devlong64_ro",
    "scalar_devlong64_rw",
    "scalar_devlong_ro",
    "scalar_devlong_rw",
    "scalar_devshort_ro",
    "scalar_devshort_rw",
    "scalar_devstate_ro",
    "scalar_devstate_rw",
    "scalar_devstring_ro",
    "scalar_devstring_rw",
    "scalar_devuchar_ro",
    "scalar_devuchar_rw",
    "scalar_devulong64_ro",
    "scalar_devulong64_rw",
    "scalar_devulong_ro",
    "scalar_devulong_rw",
    "scalar_devushort_ro",
    "scalar_devushort_rw"
]

# HDB++ stores seconds and microseconds in separate fields, but
# we want to combine them into one value. This probably a slow way...
timestampify = np.vectorize(lambda d, us: d.timestamp()*1000 + us/1000.,
                            otypes=[np.float64])


def split_cs_and_attribute(attr):
    cs, domain, family, member, name = attr.rsplit("/", 4)
    return cs, "/".join([domain, family, member, name])


class LocalNetworkAdressTranslator(AddressTranslator):

    # A simple translator for ip addresses. It's only used
    # for automatic node discovery and can be useful for
    # the case where clients are on a different network
    # from cassandra.

    def __init__(self, addr_map=None):
        self.addr_map = addr_map

    def translate(self, addr):
        new_addr = self.addr_map.get(addr)
        return new_addr


class HDBPlusPlusConnection(object):

    "A very simple direct interface to the HDB++ cassandra backend"

    def __init__(self, nodes=None, keyspace="hdb", address_map=None,
                 fetch_size=50000, cache_size=1e9, consistency_level="ONE"):
        self.nodes = nodes if nodes else ["localhost"]
        if address_map:
            translator = LocalNetworkAdressTranslator(address_map)
            self.cluster = Cluster(self.nodes, address_translator=translator)
        else:
            self.cluster = Cluster(self.nodes)

        s = self.cluster.connect(keyspace)
        s.default_consistency_level = getattr(ConsistencyLevel, consistency_level)
        s.default_timeout = 60
        self.session = aiosession(s)  # asyncio wrapper
        self.session.default_fetch_size = fetch_size

        # set up the deserializer to use numpy
        self.session.row_factory = tuple_factory
        self.session.client_protocol_handler = NumpyProtocolHandler

        self.prepare_queries()

        self._cache = SizeLimitedCache(
            max_size=cache_size,
            get_item_size=lambda df: df.memory_usage().sum())

    @property
    def attributes(self):
        return self.get_attributes()

    @property
    def configs(self):
        return self.get_att_configs()

    def prepare_queries(self):
        """
        Prepared statements run faster, since they are pre-parsed
        and stored on the db nodes. We only need to send the arguments
        for each query. Here we prepare all the queries we will use.
        """
        self.prepared = {
            "attributes": self.session.prepare(
                "SELECT cs_name, domain, family, member, name"
                " FROM att_names"
            ),
            # get info about how to retrieve all attributes
            # ('att_conf_id' is the unique attribute id, 'data_type' tells us
            # which table to look in)
            "config": self.session.prepare(
                "SELECT cs_name, att_name, att_conf_id, data_type"
                " FROM att_conf"
            ),
            # get parameters (i.e. attribute properties) for one attribute
            # gives the latest values before a given time
            "parameter": self.session.prepare(
                "SELECT * from att_parameter "
                " WHERE att_conf_id = ?"
                " AND recv_time < ?"
                " ORDER BY recv_time DESC LIMIT 1"
            ),
            "latest_parameter": self.session.prepare(
                "SELECT * from att_parameter"
                " WHERE att_conf_id = ?"
                " ORDER BY recv_time DESC LIMIT 1"
            ),
            # get the global history
            # (attributes added/removed/started/stopped...)
            "history": self.session.prepare(
                "SELECT time, time_us, event from att_history "
                " WHERE att_conf_id = ?"
                " AND time > ? AND time < ?"
                " ORDER BY time"
                " LIMIT 10"  # no point trying to display too many events
            ),
            "all_history": self.session.prepare(
                "SELECT time, time_us, event from att_history "
                " WHERE att_conf_id = ?"
                " ORDER BY time"
            ),
            # get data (one statement for each of the type tables)
            "data": {},
            "data_after": {}
        }
        for data_type in HDBPP_DATA_TYPES:
            try:
                self.prepared["data"][data_type] = self.session.prepare(
                    ("SELECT data_time, data_time_us, value_r, error_desc"
                     " FROM att_%s"
                     " WHERE att_conf_id = ?"
                     " AND period = ?") % data_type)
                self.prepared["data_after"][data_type] = self.session.prepare(
                    ("SELECT data_time, data_time_us, value_r, error_desc"
                     " FROM att_%s"
                     " WHERE att_conf_id = ?"
                     " AND period = ?"
                     " AND data_time >= ?") % data_type)
            except Exception as e:
                logging.warn("Exception creating query for %s: %r",
                             data_type, e)

    @memoized_ttl(60)
    def get_attributes(self):
        "get a list of attributes, per domain/family/member"
        # Note that cassandra does not do stuff like wildcards so we
        # have to fetch the whole attribute list (it won't be huge
        # anyway, perhaps 100000 or so) and do matching ourselves.
        names = self.session.execute(self.prepared["attributes"])
        attributes = defaultdict(list)
        for cs, domain, family, member, name in zip(names[0]["cs_name"],
                                                    names[0]["domain"],
                                                    names[0]["family"],
                                                    names[0]["member"],
                                                    names[0]["name"]):
            attributes[cs].append((domain, family, member, name))

        return attributes

    @memoized_ttl(60)
    def get_att_configs(self):
        "The attribute config table tells us where to find the data"
        result = self.session.execute(self.prepared["config"])
        configs = defaultdict(dict)
        for row in result:
            for cs, att, conf_id, data_type in zip(row["cs_name"],
                                                   row["att_name"],
                                                   row["att_conf_id"],
                                                   row["data_type"]):
                configs[cs][att] = {"id": conf_id, "data_type": data_type}
        return configs

    def get_history(self, attr, time_window=None):
        "Get the attribute event history (add/remove/start/stop/pause...)"

        att_conf_id = self.configs[attr]
        if time_window:
            query = self.prepared["history"]
            start_time, end_time = time_window
            bound = query.bind(att_conf_id, start_time, end_time)
        else:
            query = self.prepared["all_history"]
            bound = query.bind(att_conf_id)
        result = self.session.execute(bound)
        return [
            {"timestamp": row["time"] + row["time_us"] * 1e-6,
             "event": row["event"]}
            for row in result
        ]

    def get_parameters(self, attr, end_time):
        """Get the latest parameters stored for the attribute, until the given
        end time"""
        att_conf_id = self.configs[attr]
        query = self.prepared["parameter"]
        result = self.session.execute(query, att_conf_id, end_time)
        params = None
        for row in result:
            params = row
        return params

    async def get_attribute_data(self, attr, start_time=None, end_time=None):

        """Get all data points for the given attribute between
        start_time and end_time.

        Note: we'll actually query all the data for every day even
        partially covered by the time range. This is because the date
        is part of the primary key of the schema, so it's more
        efficient to split queries on date. That way each query can
        always be handled by a single node. And since we're doing that
        we might as well just query the whole day since that will make
        it easier to cache. One day shouldn't be too much data anyhow,
        e.g. <100000 points at 1s interval. In any case, this is a
        very natural way to split larger queries so that they can
        be run concurrently.
        """

        # default to the last 24 hours
        if not start_time:
            start_time = datetime.now() - timedelta(days=1)
        if not end_time:
            end_time = datetime.now()

        # fix naive timestamps (assume they are UTC!)
        local_zone = tz.tzlocal()
        print(start_time.tzinfo)
        if not start_time.tzinfo:
            start_time = start_time.replace(tzinfo=local_zone)
        if not end_time.tzinfo:
            end_time = end_time.replace(tzinfo=local_zone)

        # figure out which periods we need to search
        # Note: periods are in local time, timestamps in UTC!
        start_date = start_time.astimezone(local_zone).date()
        end_date = end_time.astimezone(local_zone).date()
        periods = [(start_date + timedelta(days=d)).strftime("%Y-%m-%d")
                   for d in range((end_date - start_date).days + 1)]
        logging.debug("fetching periods: %r", periods)
        cs, name = split_cs_and_attribute(attr)

        def chunker(it, n):
            return (it[i:i + n] for i in range(0, len(it), n))

        # request all periods at once
        period_queries = [self.get_attribute_period(cs, name, period)
                          for period in periods]
        total_results = []

        for chunk in chunker(period_queries, 50):
            chunk_results = await asyncio.gather(*chunk)
            total_results.extend(chunk_results)

        if total_results:
            return pd.concat(total_results, ignore_index=True)

    # @retry_future(max_retries=3)
    def get_attribute_period(self, cs, attr, period):
        """
        Return the data for a given attribute and period (day)
        Checks and updates the cache.
        Note that data in historical periods should never change,
        and terefore it's straightforward to cache it. Today's data
        gets special treatment since new data can still arrive.
        """
        if period == str(date.today()):
            # OK, we're requesting today's data. This means we're
            # still writing data to this period and caching is not
            # quite as simple as with older data, which can't change.
            return self._get_attribute_period_today(cs, attr)
        try:
            result = self._cache[cs, attr, period]
            # the data is found in the cache, we just need to wrap it
            # up in a future that returns immediately. This way we don't
            # have to care later and can handle all data the same way.
            fut = asyncio.Future()
            fut.set_result(result)
            return fut
        except KeyError:
            fut = self._get_attribute_period(cs, attr, period)
            # make sure the cache gets updated, unless the date is in the
            # future; we don't want to cache nonexistent data!
            if datetime.strptime(period, "%Y-%m-%d").date() < date.today():
                fut.add_done_callback(
                    lambda fut_: (
                        self._cache.set((cs, attr, period), fut_.result())
                        if not fut_.exception()
                        else None
                    ))
            return fut

    def _get_attribute_period_today(self, cs, attr):

        """Helper to specifically get the data for today, using the
        cached data (if any) and only queries the db for new points."""

        today = str(date.today())

        try:
            cached = self._cache[cs, attr, today]
        except KeyError:
            # no data in the cache
            fut = self._get_attribute_period(cs, attr, today)
        else:
            if cached.empty:
                # the cached data is empty
                fut = self._get_attribute_period(cs, attr, period=today)
            else:
                # There is cached data, but we still need to fetch any new
                # data points and append them. This is a little tricky
                # since the "time" column is in seconds and then
                # microseconds are stored in "time_us". This means that we
                # can't query at better than second precision and have to
                # truncate the cached data before appending the new
                # points, or we'd risk overlapping points.
                latest = cached["data_time"].max()
                latest_s = datetime.utcfromtimestamp(int(latest.timestamp()))
                truncated = cached[cached["data_time"] < latest_s]
                data_fut = self._get_attribute_period(
                    cs, attr, period=today, after=latest_s)
                fut = asyncio.Future()
                data_fut.add_done_callback(
                    lambda fut_: fut.set_result(
                        pd.concat([truncated, fut_.result()],
                                  ignore_index=True)))

        return fut

    def _get_attribute_period(self, cs, attr, period, after=None):
        """
        Get data for the given period from the database. Optionally filter
        to only get the points after a given timestamp.
        """
        config = self.configs[cs][attr]
        if after:
            query = self.prepared["data_after"][config["data_type"]]
            attr_bound = query.bind([config["id"], period, after])
        else:
            query = self.prepared["data"][config["data_type"]]
            attr_bound = query.bind([config["id"], period])
        return self.session.execute_future(attr_bound)
