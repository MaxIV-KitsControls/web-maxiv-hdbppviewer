"""
Prototype of HDB++ archive data viewer.

Basic functionality:
- searching for stored attributes
- selecting which attributes to add
- free scrolling/zooming
- two separate Y axes (no restriction but needs UI)
- Y axes autoscale
- encodes current view in URL
- min/max etc on mouseover

Missing functionality:
- configure color, Y-axis etc for each line
- realtime updates

Improvements needed:
- data readout and packaging is hacky
- Re-loads the view each time anything changes, maybe possible
  to be smarter here? We're caching db results at least.
- UI is very basic
- Plotting is a mess
- mouseover stuff messy
- Probably using pandas etc inefficiently

Ideas:
- Use websocket to send data as we get it instead of afterwards?
- use dask for lazy parallelization

"""

import base64
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import fnmatch
import json
import logging
import re
import time
from weakref import WeakSet, WeakValueDictionary

import aiohttp
import asyncio
from aiohttp import web
from aiohttp import MultiDict
from asyncio import Queue, QueueEmpty
import numpy as np

from plot import get_data, get_extrema, make_axis_images
from hdbpp import HDBPlusPlusConnection
from utils import timer


CASSANDRA_NODES = ["10.0.3.1"]
# CASSANDRA_NODES = ["g-v-db-cn-0"]  #, "g-v-db-cn-1", "g-v-db-cn-2", "g-v-db-cn-3"]
# CASSANDRA_NODES = ["b-v-db-cn-1"]  #, "g-v-db-cn-1", "g-v-db-cn-2", "g-v-db-cn-3"]
CASSANDRA_KEYSPACE = "hdb"
# This is a map between blue IPs and green hostnames. It's needed for clients
# on the green network to be able to automatically find cassandra nodes since
# they use blue IPs.
CASSANDRA_ADDRESS_TRANSLATION = {
     # "172.16.2.31": "g-v-db-cn-0",
     # "172.16.2.32": "g-v-db-cn-1",
     # "172.16.2.33": "g-v-db-cn-2",
     # "172.16.2.34": "g-v-db-cn-3"
}
PORT = 5005


async def get_controlsystems(hdbpp, request):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, hdbpp.get_att_configs)
    controlsystems = sorted(result.keys())
    data = json.dumps({"controlsystems": controlsystems})
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


async def get_attributes(hdbpp, request):
    cs = request.GET["cs"]
    search = request.GET["search"]
    max_n = request.GET.get("max", 100)
    regex = fnmatch.translate(search)
    logging.info("search: %s", search)
    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(None, hdbpp.get_attributes)
    attributes = sorted("%s/%s/%s/%s" % attr
                        for attr in result[cs])
    matches = [attr for attr in attributes
               if re.match(regex, attr, re.IGNORECASE)]
    data = json.dumps({"attributes": matches})
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


async def get_images(hdbpp, request):

    "Get images for a bunch of attributes; one image per y-axis"

    # TODO: probably makes more sense to send one image per attribute
    # instead. The overhead is pretty low anyway and it makes it
    # possible to do more dynamic stuff on the client like hiding/
    # showing attributes, changing color...

    params = await request.json()

    attributes = params["attributes"]
    time_range = params["time_range"]
    size = params["size"]
    axes = params.get("axes")

    logging.debug("Attributes: %r", attributes)
    logging.debug("Time range: %r", time_range)
    logging.debug("Image size: %r", size)
    logging.debug("Axis config: %r", axes)

    # Note: the following should be done in a more pipeline:y way, since many
    # parts can be done in parallel.

    # get archived data from cassandra
    with timer("Fetching from database"):
        data = await get_data(hdbpp, attributes, time_range)

    # calculate the max/min for each y-axis
    with timer("Calculating extrema"):
        per_axis = get_extrema(attributes, data, time_range, axes)

    # Now generate one image for each y-axis.
    loop = asyncio.get_event_loop()
    with timer("Processing"):
        images, descs = await loop.run_in_executor(
            None, partial(make_axis_images, per_axis, time_range, size, axes))

    data = json.dumps({"images": images, "descs": descs})
    response = web.Response(body=data.encode("utf-8"),
                            content_type="application/json")
    # With compression, the size of the data goes down even further, almost
    # an order of magnitude. Typical size is a few 10s of kB! It's up to the
    # client to allow it, though.
    response.enable_compression()
    return response


if __name__ == "__main__":

    logging.basicConfig(level=logging.DEBUG)

    app = aiohttp.web.Application(debug=True)
    loop = asyncio.get_event_loop()
    loop.set_default_executor(ThreadPoolExecutor(10))

    hdbpp = HDBPlusPlusConnection(nodes=CASSANDRA_NODES,
                                  keyspace=CASSANDRA_KEYSPACE,
                                  address_map=CASSANDRA_ADDRESS_TRANSLATION)

    app.router.add_route('GET', '/controlsystems', partial(get_controlsystems, hdbpp))
    app.router.add_route('GET', '/attributes', partial(get_attributes, hdbpp))
    app.router.add_route('POST', '/image', partial(get_images, hdbpp))
    app.router.add_static('/', 'static')

    handler = app.make_handler(debug=True)
    f = loop.create_server(handler, '0.0.0.0', PORT)
    logging.info("Point your browser to http://localhost:%d/index.html", PORT)
    srv = loop.run_until_complete(f)
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        print("Ctrl-C was pressed")
    finally:
        srv.close()
        loop.run_until_complete(srv.wait_closed())
        loop.run_until_complete(handler.finish_connections(1.0))
        loop.run_until_complete(app.finish())

    loop.close()
