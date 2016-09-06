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
- removing lines
- Log Y axes
- dialog for setting time range
- configure color, Y-axis etc for each line
- realtime updates

Improvements needed:
- data readout and packaging is hacky
- Re-loads the view each time anything changes, maybe possible
  to be smarter here?
- UI is very basic
- Plotting is a mess
- mouseover stuff messy

Ideas:
- Use websocket to send data as we get it instead of afterwards?

"""

import base64
from functools import partial
import fnmatch
import json
import logging
import re
import io
import time
from collections import defaultdict
from weakref import WeakSet, WeakValueDictionary

import aiohttp
import asyncio
from aiohttp import web
from aiohttp import MultiDict
from asyncio import Queue, QueueEmpty
import numpy as np
import dask
import cassandra
import pandas
import datashader
import xarray

from hdbpp import HDBPlusPlusConnection


CASSANDRA_NODES = ["localhost"]
#CASSANDRA_NODES = ["b-v-db-cn-3"]
CASSANDRA_KEYSPACE = "hdb"
PORT = 5005


timestampify = np.vectorize(lambda x: x.timestamp()*1000, otypes=[np.float64])


def get_attr_config(config_str):
    "Parse a string like <attribute>:<#axis>:<color>"
    attr, y_axis, color = re.match("([^:]+):(\d+):(.+)", config_str).groups()
    return dict(name=attr, y_axis=int(y_axis), color=color)


def make_image(data, time_range, y_range, size):
    "Flatten the given range of the data into a 2d image"
    cvs = datashader.Canvas(x_range=time_range, y_range=y_range,
                            plot_width=size[0], plot_height=size[1])
    # aggregate some useful measures
    agg = cvs.line(source=data["data"],
                   x="t", y="v",
                   agg=datashader.summary(
                       count=datashader.count("v"),
                       vmean=datashader.mean("v"),
                       vmin=datashader.min("v"),
                       vmax=datashader.max("v")
                   ))
    color = data["info"].get("color", "red")
    image = datashader.transfer_functions.interpolate(agg["count"], cmap=[color])

    # TODO: make this "sparse" if there are gaps where there are no
    # points.
    vmin = np.nanmin(agg["vmin"].values, axis=0)
    vmax = np.nanmax(agg["vmax"].values, axis=0)
    desc = {
        "min": np.where(np.isnan(vmin), None, vmin).tolist(),
        "max": np.where(np.isnan(vmax), None, vmax).tolist()
    }
    return image, desc


@asyncio.coroutine
def get_attributes(hdbpp, request):
    search = request.GET["search"]
    max_n = request.GET.get("max", 100)
    regex = fnmatch.translate(search)
    logging.info("search: %s", search)
    # loop = asyncio.get_event_loop()  # TODO: this looks stupid

    attributes = sorted("%s/%s/%s/%s" % attr for attr in hdbpp.attributes)

    matches = [attr for attr in attributes
               if re.match(regex, attr, re.IGNORECASE)]
    data = json.dumps({"attributes": matches})
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


def encode_image(image):
    "Take an image and encode it properly for inclusion in a JSON response"
    pil_image = image.to_pil()
    bytesio = io.BytesIO()
    # convert into a PNG
    pil_image.save(bytesio, format='PNG')
    data = bytesio.getvalue()
    return base64.b64encode(data)


async def get_image(hdbpp, request):

    "Get images for a bunch of attributes; one image per y-axis"

    # params = await request.json()
    attributes = [get_attr_config(attr)
                  for attr in request.GET["attributes"].split(",")]
    time_range = [float(x) for x in request.GET["time_range"].split(",")]
    size = [int(x) for x in request.GET["size"].split(",")]

    logging.debug("Attributes: %r", attributes)
    logging.debug("Time range: %r", time_range)
    logging.debug("Image size: %r", size)

    images = {}
    per_axis = defaultdict(dict)
    loop = asyncio.get_event_loop()

    # First get data from the DB and sort by y-axis
    for attribute in attributes:
        dfs = []
        # load data points for the attribute from the archive database
        name = attribute["name"]
        call = partial(
            hdbpp.get_attribute_data,
            attr=name.lower(),
            start_time=time_range[0],
            end_time=time_range[1])
        results = await loop.run_in_executor(None, call)
        for result in results:
            while True:
                rows = result.current_rows[0]
                df = pandas.DataFrame(dict(t=timestampify(rows["data_time"]),
                                           v=rows["value_r"], e=rows["error_desc"]))
                dfs.append(df)
                if result.has_more_pages:
                    result.fetch_next_page()
                else:
                    break
        data = pandas.concat(dfs, ignore_index=True)

        logging.debug("Length of %s: %d", name, len(data))

        # find local extrema
        y_axis = attribute["y_axis"]
        relevant = data[(data["t"] >= time_range[0]) &
                        (data["t"] <= time_range[1])]
        value_max = relevant["v"].max()
        value_min = relevant["v"].min()

        per_axis[y_axis][name] = dict(
            data=data, info=attribute,
            y_range=(value_min, value_max))

    # Now generate one image for each y-axis. Since all the attributes on an
    # axis will have the same scale, there's no point in sending one image
    # for each attribute.
    descs = {}
    for y_axis, attributes in per_axis.items():

        logging.debug("Computing image for axis %r %r",
                      y_axis, sorted(attributes.keys()))

        # find the extrema for the axis
        axis_min = axis_max = None
        nodata = set()
        for name, data in attributes.items():
            vmin, vmax = data["y_range"]
            if np.isnan(vmin) or np.isnan(vmax) or vmin == vmax:
                # TODO: figure out what to do in the case when there's only one
                # point, or all points have the same value. At least we can't
                # use the naive method below to calculate the range.
                # For now we just hope it never actually happens...
                nodata.add(name)
                continue
            if axis_min is None:
                axis_min = vmin
            else:
                axis_min = min(axis_min, vmin)
            if axis_max is None:
                axis_max = vmax
            else:
                axis_max = max(axis_max, vmax)

        if axis_min == axis_max:
            logging.debug("Too few points in interval for axis %r!", y_axis)
            continue

        if axis_min is None or axis_max is None:
            logging.debug("Could not calculate limits for axis %r!", y_axis)
            continue

        if np.isnan(axis_min) or np.isnan(axis_max):
            logging.debug("No data for axis %r!", y_axis)
            continue

        axis_d = axis_max - axis_min
        padding = 0.05 * axis_d
        y_range = (axis_min - padding, axis_max + padding)
        logging.debug("Axis %r has range %r", y_axis, y_range)

        # project the data into an image (using datashader)
        axis_images = []
        for name, data in attributes.items():
            if name in nodata:
                continue
            logging.debug("Making %r image for %s", size, name)
            print(data)
            image, desc = make_image(data, time_range, y_range, size)
            print(image)
            axis_images.append(image)
            descs[name] = desc

        # flatten the images into a single one
        if not axis_images:
            logging.debug("No images for axis %r!", y_axis)
            continue
        logging.debug("Stacking %d images", len(axis_images))
        stacked_image = datashader.transfer_functions.stack(*axis_images)

        logging.debug("Encoding image")
        encoded_data = encode_image(stacked_image)

        images[str(y_axis)] = {
            "image": encoded_data.decode("utf-8"),
            "y_range": y_range,
            "x_range": time_range
        }
        # TODO: also grab configuration, e.g. label, unit, ...
        # Note that this can also change over time!

    data = json.dumps({"images": images, "descs": descs})
    return web.Response(body=data.encode("utf-8"),
                        content_type="application/json")


if __name__ == "__main__":

    logging.basicConfig(level=logging.DEBUG)

    app = aiohttp.web.Application(debug=True)
    loop = asyncio.get_event_loop()

    hdbpp = HDBPlusPlusConnection(nodes=CASSANDRA_NODES,
                                  keyspace=CASSANDRA_KEYSPACE)
    cache = {}

    app.router.add_route('GET', '/attributes', partial(get_attributes, hdbpp))
    app.router.add_route('GET', '/image', partial(get_image, hdbpp))
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