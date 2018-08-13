import asyncio
from functools import partial
from itertools import chain
import json
import time

import pandas as pd
from pandas.tseries.frequencies import to_offset


def round_timestamp(t, freq):
    "round a Timestamp to a specified frequency"
    return round(t.value/freq.delta.value)*freq.delta.value


def resample(df, freq=None):
    """
    Resample helper
    For display purposes it may make sense to downsample the data
    to some reasonable time slice, e.g 5 minutes.
    "freq" should be a string on the form 30s, 15m etc
    """

    # Here we calculate a new column which is the microsecond timestamp.
    # Datashader does not (yet) support datetime axes.
    df.loc[:, "t"] = pd.Series(
        (df["data_time"].astype("int64") // 1000  # datetime64[ns]
         + df["data_time_us"]),
        index=df.index)

    if not freq:
        return df

    # Pandas uses some weird conventions for time intervals, let's
    # translate (TODO: there may be more of these)
    if freq.endswith("ms"):
        freq = freq.replace("ms", "L")
    elif freq.endswith("s"):
        freq = freq.replace("s", "S")
    elif freq.endswith("m"):
        freq = freq.replace("m", "T")

    # TODO: perhaps this is not really necessary, downsampling on ms frequence
    # seems pretty useless... can we get away without creating a new index?
    df.index = pd.to_datetime(df["t"], unit="us")
    return df.groupby(partial(round_timestamp, freq=to_offset(freq))).mean()


def render_data_csv(request, data):
    "Render data when the client requests text format, e.g. Accept:text/csv"
    return "\n".join("{}\n{}".format(
        name, "".join(df.to_csv(columns=["t", "value_r"], index=False,
                                sep=",", header=["t[us]", "value_r"])))
                     for name, df in data.items()).encode()


def render_data_json(request, data):
    "Renderer for when the client wants json, i.e. 'Accept:application/json'"
    # The output follows the Grafana data source format, see
    # http://docs.grafana.org/plugins/developing/datasources/

    # Note: this implementation will potentially use a lot of memory
    # as it will create two new representations of the data in
    # memory...
    return json.dumps([
        {
            "target": name,
            "datapoints": list(zip(df["value_r"],
                                   df["t"].astype("float") / 1000))
        }
        for name, df in data.items()
    ]).encode()


async def get_data(hdbpp, attributes, time_range, interval=None,
                   restrict_time=False):
    """
    Fetch data for all the given attributes over the time range. It
    allows restricting the time range exactly, otherwise it will
    always return entire days of data. It also allows an optional
    interval for resampling the data.

    Note: this is a coroutine, and so must be run in an asyncio
    event loop!
    """

    t0, t1 = time_range

    futures = [hdbpp.get_attribute_data(attribute.lower(),
                                        t0,
                                        t1)
               for attribute in attributes]

    results = await asyncio.gather(*futures)

    if restrict_time:
        return {
            attr: resample(res[(t0 <= res["data_time"])
                               & (res["data_time"] <= t1)], interval)
            for attr, res in zip(attributes, results)
        }

    return {
        attr: resample(res, interval)
        for attr, res in zip(attributes, results)
    }
