"""
Backend for a HDB++ archive data viewer.

Basic functionality:
- searching for stored attributes
- selecting which attributes to add
- free scrolling/zooming
- two separate Y axes
- Y axes autoscale
- encodes current view in URL
- min/max etc on mouseover
- endpoints for getting raw data in CSV/JSON formats

Missing functionality:
- configure color, etc for each line
- realtime updates (just a periodic reload should be fine)
- show units, labels, ...
- ability to identify lines e.g. by hover
- display errors?
- manual Y axis scaling
- showing write values
- showing archiving history like add/remove/start/stop...

Improvements needed:
- Re-loads the view each time anything changes, maybe possible
  to be smarter here? We're caching db results at least.
- UI is very basic
- Plotting is a mess, maybe use canvas instead
- mouseover stuff messy
- Probably using pandas etc inefficiently

Ideas:
- Use websocket to send data as we get it instead of afterwards?
- use dask for lazy parallelization

"""

import base64
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from dateutil.parser import parse as parse_time
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
import aiohttp_cors
from aiohttp_utils import negotiation
from asyncio import Queue, QueueEmpty

from plot import get_extrema, make_axis_images
from hdbpp import HDBPlusPlusConnection
from utils import timer
from data import get_data, render_data_csv, render_data_json


async def get_controlsystems(hdbpp, request):
    "Handle queries for the list of TANGO hosts we have data for"
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, hdbpp.get_att_configs)
    controlsystems = sorted(result.keys())
    data = json.dumps({"controlsystems": controlsystems})
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


async def get_attributes(hdbpp, request):
    "Handle queries for attribute names"
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
    time_range = [parse_time(params["time_range"][0]),
                  parse_time(params["time_range"][1])]
    size = params["size"]
    axes = params.get("axes")

    logging.debug("Attributes: %r", attributes)
    logging.debug("Time range: %r", time_range)
    logging.debug("Image size: %r", size)
    logging.debug("Axis config: %r", axes)

    # Note: unfortunately, the way things work right now it's not
    # possible to run these steps in parallel. E.g. in order to create
    # the final image, we need all the data since we must know the
    # global max and min values. Luckily, usually the dominating
    # factor will be the database calls, and these can be
    # parallelized.

    # get archived data from cassandra
    with timer("Fetching from database"):
        attr_names = [a["name"] for a in attributes]
        data = await get_data(hdbpp, attr_names, time_range)

    # calculate the max/min for each y-axis
    with timer("Calculating extrema"):
        per_axis = get_extrema(attributes, data, time_range, axes)

    # Now generate one image for each y-axis.
    loop = asyncio.get_event_loop()
    with timer("Making images"):
        # TODO: for now, we're running this in the default thread pool.
        # I haven't benchmarked this, but I'm hoping that this will speed
        # things up (apart from not blocking) since numpy etc can release
        # the GIL. Maybe look into using a process pool?
        images, descs = await loop.run_in_executor(
            None, partial(make_axis_images, per_axis, time_range, size, axes))

    # Now wrap all the results up in a JSON response.
    data = json.dumps({"images": images, "descs": descs})
    response = web.Response(body=data.encode("utf-8"),
                            content_type="application/json")
    # With compression, the size of the data goes down even further, almost
    # an order of magnitude. Typical size is a few 10s of kB! It's up to the
    # client to allow it, though.
    response.enable_compression()
    return response


async def post_raw_query(hdbpp, request):

    "Handle queries for data in 'raw' (csv or json) form"

    params = await request.json()
    attributes = ["{cs}/{target}".format(**t) for t in params["targets"]]
    time_range = [parse_time(params["range"]["from"]),
                  parse_time(params["range"]["to"])]
    interval = params.get("interval")
    data = await get_data(hdbpp, attributes, time_range, interval,
                          restrict_time=True)

    response = negotiation.Response(data=data)
    response.enable_compression()
    return response

async def post_raw_query_http(hdbpp, request):

    "Handle queries for data in 'raw' (csv or json) form from the browser"

    params = await request.json()

    attributes = params["attributes"]
    time_range = [parse_time(params["time_range"][0]),
                  parse_time(params["time_range"][1])]

    data = await get_data(hdbpp, attributes, time_range)

    response = negotiation.Response(data=data)
    response.enable_compression()
    return response

async def post_raw_search(hdbpp, request):

    "Handle queries to search for attributes by name"

    # Note: follows the Grafana JSON API

    # TODO: probably makes sense to merge this with the other
    # attribute search endpoint "get_attributes" above?

    params = await request.json()
    term = params["target"]
    cs = params["cs"]

    search = params["target"]

    regex = ".*{}.*".format(search)
    logging.info("search: %s", search)
    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(None, hdbpp.get_attributes)
    attributes = sorted("%s/%s/%s/%s" % attr
                        for attr in result[cs])
    matches = [attr
               for attr in attributes
               if re.match(regex, attr, re.IGNORECASE)]
    data = json.dumps(matches)
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


if __name__ == "__main__":

    import argparse
    import configparser

    from middleware import IndexMiddleware

    # parse commandline arguments
    parser = argparse.ArgumentParser(
        description='A web based viewer for HDB++ data')
    parser.add_argument("-c", "--config", type=str, default="hdbppviewer.conf",
                        help="Path to a configuration file")
    parser.add_argument("-d", "--debug", action="store_true",
                        help="Run in debug mode")
    args = parser.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    # load configuration
    config = configparser.RawConfigParser()
    config.read(args.config)
    PORT = config.getint("server", "port")
    CASSANDRA_NODES = config.get("hdbpp:cassandra", "nodes").split(",")
    CASSANDRA_KEYSPACE = config.get("hdbpp:cassandra", "keyspace")
    if config.has_section("hdbpp:cassandra_address_translation"):
        CASSANDRA_ADDRESS_TRANSLATION = dict(
            config.items("hdbpp:cassandra_address_translation"))
    else:
        CASSANDRA_ADDRESS_TRANSLATION = {}
    DATA_CACHE_SIZE = config.getint("server", "data_cache_size")

    # start web server
    app = aiohttp.web.Application(debug=args.debug,
                                  middlewares=[IndexMiddleware()])
    loop = asyncio.get_event_loop()
    loop.set_default_executor(ThreadPoolExecutor(10))

    hdbpp = HDBPlusPlusConnection(nodes=CASSANDRA_NODES,
                                  keyspace=CASSANDRA_KEYSPACE,
                                  address_map=CASSANDRA_ADDRESS_TRANSLATION,
                                  cache_size=DATA_CACHE_SIZE)

    app.router.add_route('GET', '/controlsystems',
                         partial(get_controlsystems, hdbpp))
    app.router.add_route('GET', '/attributes',
                         partial(get_attributes, hdbpp))
    app.router.add_route('POST', '/image',
                         partial(get_images, hdbpp))

    # Configure default CORS settings. This is required for e.g. grafana
    # to be able to access the service.
    # TODO: this may be too permissive.
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
    })
    # set up content negotiation so that clients can request
    # e.g. csv data.
    negotiation.setup(app, renderers=OrderedDict([
        ('text/plain', render_data_csv),
        ('text/csv', render_data_csv),
        ('application/json', render_data_json)
    ]))

    cors.add(app.router.add_route('POST', '/query',
                                  partial(post_raw_query, hdbpp)))
    cors.add(app.router.add_route('POST', '/search',
                                  partial(post_raw_search, hdbpp)))

    cors.add(app.router.add_route('POST', '/httpquery',
                                  partial(post_raw_query_http, hdbpp)))

    # everything else assumed to be requests for static files
    # maybe add '/static'?
    cors.add(app.router.add_static('/', 'static'))

    handler = app.make_handler(debug=args.debug)
    f = loop.create_server(handler, '0.0.0.0', PORT)
    logging.info("Point your browser to http://localhost:%d/", PORT)
    srv = loop.run_until_complete(f)
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        print("Ctrl-C was pressed")
    finally:
        srv.close()
        loop.run_until_complete(srv.wait_closed())
        loop.run_until_complete(handler.finish_connections(1.0))

    loop.close()
