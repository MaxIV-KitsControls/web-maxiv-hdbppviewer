from functools import lru_cache
import logging
import time
from datetime import date, timedelta, datetime

from cassandra.cluster import Cluster
from cassandra.protocol import NumpyProtocolHandler, LazyProtocolHandler
from cassandra.query import tuple_factory
from cassandra.connection import InvalidRequestException


TANGO_TYPES = [
    'DevVarLongArray', 'DevVarStringArray', 'DevEnum', 'DevVarLongStringArray', 'DevVarFloatArray', 'DevVarStateArray', 'ConstDevString', 'DevVoid', 'DevLong64', 'DevVarULongArray', 'DevDouble', 'DevInt', 'DevULong64', 'DevState', 'DevUShort', 'DevVarUShortArray', 'DevShort', 'DevVarLong64Array', 'DevBoolean', 'DevVarDoubleStringArray', 'DevVarULong64Array', 'DevString', 'DevUChar', 'DevEncoded', 'DevVarCharArray', 'DevVarShortArray', 'DevVarBooleanArray', 'DevPipeBlob', 'DevFloat', 'DevVarDoubleArray', 'DevLong', 'DevULong']


def get_hdbpp_data_types():
    return [
        "%s_%s_%s" % (fmt, typ.lower(), per)
        for fmt in ("scalar", "array")
        for typ in TANGO_TYPES
        for per in ("ro", "rw")
    ]


class HDBPlusPlusConnection(object):

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
        return list(self.get_attributes())

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
            "data": {}
        }
        for data_type in get_hdbpp_data_types():
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

    def get_attributes(self):
        # get a list of attributes, per domain/family/member
        names = self.session.execute(self.prepared["attributes"])
        attributes = zip(names[0]["domain"],
                         names[0]["family"],
                         names[0]["member"],
                         names[0]["name"])
        return attributes

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

    @lru_cache(maxsize=1024)
    def get_attribute_period(self, attr, period):
        config = self.configs[attr]
        query = self.prepared["data"][config["data_type"]]
        attr_bound = query.bind([config["id"], period])
        return self.session.execute(attr_bound)
