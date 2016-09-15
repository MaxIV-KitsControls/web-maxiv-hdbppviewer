from functools import lru_cache
import logging
import time
from datetime import date, timedelta, datetime

from cassandra.cluster import Cluster
from cassandra.protocol import NumpyProtocolHandler, LazyProtocolHandler
from cassandra.query import tuple_factory
from cassandra.connection import InvalidRequestException
import numpy as np
import pandas as pd

from util import memoized_ttl


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


timestampify = np.vectorize(lambda x: x.timestamp()*1000, otypes=[np.float64])


class HDBPlusPlusConnection(object):

    "A very simple direct interface to the HDB++ cassandra backend"

    def __init__(self, nodes=None, keyspace="hdb", fetch_size=50000):
        self.nodes = nodes if nodes else ["localhost"]
        self.cluster = Cluster(self.nodes)

        self.session = self.cluster.connect(keyspace)
        self.session.default_fetch_size = fetch_size

        # set up the deserializer to use numpy
        self.session.row_factory = tuple_factory
        self.session.client_protocol_handler = NumpyProtocolHandler

        self.prepare_queries()

    @property
    def attributes(self):
        return self.get_attributes()

    @property
    def configs(self):
        return self.get_att_configs()

    def prepare_queries(self):
        # get a mapping from attribute => UUID
        self.prepared = {
            "attributes": self.session.prepare(
                "select cs_name, domain, family, member, name "
                "from att_names "
            ),
            "config": self.session.prepare(
                "select att_name,att_conf_id,data_type "
                "from att_conf "
            ),
            "parameter": self.session.prepare(
                "select * from att_parameter "
                "where att_conf_id = ? and "
                "recv_time > ? and recv_time < ?"
            ),
            "latest_parameter": self.session.prepare(
                "select * from att_parameter "
                "where att_conf_id = ? "
                "order by recv_time desc limit 1"
            ),
            "data": {}
        }
        for data_type in HDBPP_DATA_TYPES:
            try:
                self.prepared["data"][data_type] = self.session.prepare(
                    ("SELECT data_time,value_r,error_desc "
                     "FROM att_%s "
                     "WHERE att_conf_id = ? "
                     "AND period = ? ") % data_type)
                     # "AND data_time > ? "
                     # "AND data_time < ?") % data_type)
            except Exception as e:
                logging.warn("Exception creating query for %s", data_type)
                pass

    @memoized_ttl(60)
    def get_attributes(self):
        # get a list of attributes, per domain/family/member
        # Note that cassandra does not do stuff like wildcards so we
        # have to fetch the whole attribute list (it won't be huge
        # anyway, perhaps 100000 or so) and do matching ourselves.
        names = self.session.execute(self.prepared["attributes"])
        attributes = zip(names[0]["domain"],
                         names[0]["family"],
                         names[0]["member"],
                         names[0]["name"])
        return list(attributes)

    @memoized_ttl(60)
    def get_att_configs(self):
        result = self.session.execute(self.prepared["config"])
        configs = {
            att_name: {
                "id": att_conf_id,
                "data_type": data_type
            }
            for row in result
            for att_name, att_conf_id, data_type
            in zip(row["att_name"], row["att_conf_id"], row["data_type"])
        }
        return configs

    # def get_parameter(self, attr, start_time=None, end_time=None):
    #     att_conf_id = self.configs[attr]
    #     if not start_time or not end_time:
    #         params = self.session.execute(self.prepared["latest_parameter"], att_conf_id)

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
        periods = (str(start_date + timedelta(days=d))
                   for d in range((end_date - start_date).days + 1))
        return [self.get_attribute_period(attr, period)
                for period in periods]

    def get_attribute_period(self, attr, period):
        "Return the data for a given attribute and period (day)"
        if period == str(date.today()):
            print("Today's data requested; not using cache")
            return self._get_attribute_period.__wrapped__(self, attr, period)
        try:
            return self._get_attribute_period(attr, period)
        except KeyError:
            # Don't know why this sometimes happens?
            return self._get_attribute_period.__wrapped__(self, attr, period)

    @lru_cache(maxsize=1024)
    def _get_attribute_period(self, attr, period):
        """Cached version. Since past archived data never changes, it's
        straightforward to cache it.
        """
        config = self.configs[attr]
        query = self.prepared["data"][config["data_type"]]
        attr_bound = query.bind([config["id"], period])
        res = self.session.execute(attr_bound)
        dfs = []
        while True:
            rows = res.current_rows[0]
            df = pd.DataFrame(dict(v=rows["value_r"],
                                   e=rows["error_desc"],
                                   t=timestampify(rows["data_time"])))
            dfs.append(df)
            if res.has_more_pages:
                res.fetch_next_page()
            else:
                break
        return pd.concat(dfs, ignore_index=True)
