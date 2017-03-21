from collections import defaultdict
from functools import lru_cache
import logging
import time
from datetime import date, timedelta, datetime
from dateutil import tz

from cassandra.cluster import Cluster
from cassandra.protocol import NumpyProtocolHandler, LazyProtocolHandler
from cassandra.policies import AddressTranslator
from cassandra.query import tuple_factory
from cassandra.connection import InvalidRequestException

import numpy as np
import pandas as pd

from utils import memoized_ttl, LRUDict


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
                 fetch_size=50000):
        self.nodes = nodes if nodes else ["localhost"]
        if address_map:
            translator = LocalNetworkAdressTranslator(address_map)
            self.cluster = Cluster(self.nodes, address_translator=translator)
        else:
            self.cluster = Cluster(self.nodes)

        self.session = self.cluster.connect(keyspace)
        self.session.default_fetch_size = fetch_size

        # set up the deserializer to use numpy
        self.session.row_factory = tuple_factory
        self.session.client_protocol_handler = NumpyProtocolHandler

        self.prepare_queries()

        self._today = None
        self._today_cache = LRUDict(maxduration=3600)

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
                     # "AND data_time > ? "
                     # "AND data_time < ?") % data_type)
                self.prepared["data_after"][data_type] = self.session.prepare(
                    ("SELECT data_time, data_time_us, value_r, error_desc"
                     " FROM att_%s"
                     " WHERE att_conf_id = ?"
                     " AND period = ?"
                     " AND data_time >= ?"
                     # " AND data_time_us > ?"
                     # "AND data_time < ?") % data_type)
                    ) % data_type)

            except Exception as e:
                logging.warn("Exception creating query for %s", data_type)
                pass

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

    def get_attribute_data(self, attr,
                           start_time=None,
                           end_time=None,
                           asynchronous=False):

        """Request all data points for the given attribute between
        start_time and end_time.

        Note: we'll actually query all the data or each day event
        partially covered by the time window. Returns a list of result
        objects, one per date. This is because the date is part of the
        primary key of the schema, so it's more efficient to split
        queries on date. That way each query can always be handled by
        a single node. And since we're doing that we might as well
        just query the whole day since that will make it easier to
        cache (and the query should be slightly faster?). One day
        shouldn't be too much data anyhow, e.g. <100000 points
        at 1s interval. This should be evaluated, though.

        Note: the cache ignores today's date, as we cannot assume that
        it's static. This logic needs checking, there might be
        timezone issues etc. Also it might be worth thinking about a
        more fine-grained caching scheme for this case, as it will be
        quite a common use case to periodically reload today's data
        for updating the plot.
        """

        # default to the last 24 hours
        if not start_time:
            start_time = (time.time() - 3600 * 24) * 1000
        if not end_time:
            end_time = (time.time()) * 1000

        start_date = date.fromtimestamp(start_time/1000)
        end_date = date.fromtimestamp(end_time/1000)
        periods = [(start_date + timedelta(days=d)).strftime("%Y-%m-%d")
                   for d in range((end_date - start_date).days + 1)]
        logging.debug("periods: %r", periods)
        cs, name = split_cs_and_attribute(attr)

        return [self.get_attribute_period(cs, name, period)
                for period in periods]

    def get_attribute_period(self, cs, attr, period):
        "Return the data for a given attribute and period (day)"
        if period == str(date.today()):
            # OK, we're requesting today's data. This means we're
            # still writing data to this period and caching is not
            # quite as simple as with older data.
            return self._get_attribute_period_today(cs, attr)
        try:
            return self._get_attribute_period(cs, attr, period)
        except KeyError:
            # TODO: Don't know why this sometimes happens?
            return self._get_attribute_period.__wrapped__(self, cs, attr, period)

    def _get_attribute_period_today(self, cs, attr):
        today = str(date.today())
        if today != self._today:
            logging.debug("emptying today cache")
            self._today = today
            self._today_cache.clear()

        # latest data point we know about
        cached = self._today_cache.get((cs, attr))
        if cached is None:
            # This means we have no knowledge of today's data for
            # this attribute and we'll have to fetch from the DB
            data = self._get_attribute_period.__wrapped__(self, cs, attr, today)
            latest = data["t"].max()
        else:
            # There is cached data, but we still need to fetch any new
            # data points and append them. This is a little tricky
            # since the "time" column is in seconds and then
            # microseconds are stored in "time_us". This means that we
            # can't query at better than second precision and have to
            # truncate the cached data before appending the new
            # points, or we'd risk overlapping points.
            if len(cached) > 0:
                latest = cached["t"].max()
                latest_s = int(latest/1000)
                rest = self._get_attribute_period.__wrapped__(
                    self, cs, attr, today, datetime.fromtimestamp(latest_s))
                truncated = cached[cached["t"] < 1000*latest_s]
                data = pd.concat([truncated, rest], ignore_index=True)
            else:
                # cached data is empty; check if there is any now
                data = self._get_attribute_period.__wrapped__(
                    self, cs, attr, today)
        # cache the result
        self._today_cache[(cs, attr)] = data
        return data

    @lru_cache(maxsize=1024)
    def _get_attribute_period(self, cs, attr, period, after=None):
        """Cached version. Since past archived data never changes, it's
        straightforward to cache it.
        """
        config = self.configs[cs][attr]
        if after:
            query = self.prepared["data_after"][config["data_type"]]
            attr_bound = query.bind([config["id"], period, after])
        else:
            query = self.prepared["data"][config["data_type"]]
            attr_bound = query.bind([config["id"], period])
        res = self.session.execute(attr_bound)
        dfs = []
        while True:
            rows = res.current_rows[0]
            timestamps = rows["data_time"]
            microseconds = rows["data_time_us"]

            # Add the microseconds to the timestamp
            # TODO: this seems very slow, as it's done per element.
            # Find a better way!
            t = timestampify(timestamps, microseconds)
            df = pd.DataFrame(dict(v=rows["value_r"],
                                   e=rows["error_desc"], t=t))

            dfs.append(df)
            if res.has_more_pages:
                res.fetch_next_page()
            else:
                break
        return pd.concat(dfs, ignore_index=True)
