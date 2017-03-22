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
    """resample helper
    For display purposes it may make sense to downsample the data
    to some reasonable time slice, e.g 5 minutes.
    """
    if not freq:
        return df
    df.index = pd.to_datetime(df["t"], unit="ms")
    freq = to_offset(freq)
    return df.groupby(partial(round_timestamp, freq=freq)).mean()


def render_data_csv(request, data):
    "render data when the client requests text format"
    return "\n".join("{}\n{}".format(
        name, "".join(df.to_csv(columns=["t", "v"], index=False,
                                sep="\t", header=False)
                      for df in dfs))
                     for name, dfs in data.items())


def render_data_json(request, data):
    "renderer for when the client wants json, i.e. 'Accept:application/json'"
    # the output follows the Grafana data source format, see
    # http://docs.grafana.org/plugins/developing/datasources/

    return json.dumps([
        {
            "target": name,
            "datapoints": [
                (s["v"], s["t"])
                for (_, s) in chain(*[df.iterrows() for df in dfs])
            ]
        }
        for name, dfs in data.items()
    ])


async def get_data(hdbpp, attributes, time_range, interval=None):
    "Fetch data for all the given attributes over the time range"
    # First get data from the DB and sort by y-axis
    futures = {}
    loop = asyncio.get_event_loop()
    tz = time.timezone
    for attribute in attributes:
        # load data points for the attribute from the archive database
        name = attribute.lower()
        call = partial(
            hdbpp.get_attribute_data,
            attr=name,
            start_time=time_range[0]-tz,
            end_time=time_range[1]-tz)
        # TODO: use the async functionality of cassandra-driver
        # instead of running in a thread like this
        futures[name] = loop.run_in_executor(None, call)

    # wait for all the attributes to be fetched
    t0, t1 = time_range
    await asyncio.gather(*futures.values())
    return {attribute: [resample(df[(t0 <= df["t"]) & (df["t"] <= t1)],
                                 interval)
                        for df in futures[attribute].result()]
            for attribute in attributes}
