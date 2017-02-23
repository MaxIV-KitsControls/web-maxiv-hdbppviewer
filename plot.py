import asyncio
import base64
from collections import defaultdict
from datetime import datetime
from functools import partial
import io
import logging

import datashader
import numpy as np
import pandas

from utils import timer


def make_image(data, time_range, y_range, size, scale=None, width=0):

    "Flatten the given range of the data into a 2d image"

    # Since the data comes with UTC timestamps, we need to shift it
    # according to the current timezone. This is a crude way, it would
    # be nice if datashader supported a proper time datatype natively...
    # Also note that the timestamps are milliseconds while python usually
    # deals in seconds. I guess this comes from Cassandra's JVM roots.
    t0, t1 = time_range
    utc_offset = (datetime.fromtimestamp(t0/1000) -
                  datetime.utcfromtimestamp(t0/1000)).total_seconds() * 1000
    offset_range = [t0 - utc_offset, t1 - utc_offset]
    cvs = datashader.Canvas(x_range=offset_range, y_range=y_range,
                            plot_width=size[0], plot_height=size[1],
                            y_axis_type=scale or "linear")
    # aggregate some useful measures
    agg_line = cvs.line(source=data["data"], x="t", y="v")
    agg_points = cvs.points(source=data["data"],
                            x="t", y="v",
                            agg=datashader.summary(
                                count=datashader.count("v"),
                                vmean=datashader.mean("v"),
                                vmin=datashader.min("v"),
                                vmax=datashader.max("v")
                            ))
    color = data["info"].get("color", "red")
    image = datashader.transfer_functions.shade(agg_line, cmap=[color])

    if width > 0:
        image = datashader.transfer_functions.spread(image, px=width)
        # image = datashader.transfer_functions.spread(
        #     image, mask=np.matrix([[False, False, False],
        #                            [False, True, True],
        #                            [False, True, True]]))

    with timer("Making hover info"):
        indices = np.where(np.nanmax(agg_points["count"].values, axis=0))[0]
        vmin = np.take(np.nanmin(agg_points["vmin"].values, axis=0), indices)
        vmax = np.take(np.nanmax(agg_points["vmax"].values, axis=0), indices)
        # vmean = np.take(np.nanmax(agg_points["vmean"].values, axis=0), indices)
        # TODO: aggregating the mean is not quite this simple...
        timestamps = np.take(agg_points["x_axis"].values, indices)
        count = np.take(np.sum(agg_points["count"].values, axis=0), indices)
        desc = {
            "total_points": data["points"],
            "indices": indices.tolist(),
            "min": np.where(np.isnan(vmin), None, vmin).tolist(),
            "max": np.where(np.isnan(vmax), None, vmax).tolist(),
            "timestamp": [float(t) for t in timestamps],
            # "mean": np.where(np.isnan(vmean), None, vmean).tolist(),
            "count": np.where(np.isnan(count), None, count).tolist()
        }
    return image, desc


def encode_image(image):
    "Take an image and encode it properly for inclusion in a JSON response"
    pil_image = image.to_pil()
    bytesio = io.BytesIO()
    # convert into a PNG
    pil_image.save(bytesio, format='PNG')
    data = bytesio.getvalue()
    return base64.b64encode(data)


async def get_data(hdbpp, attributes, time_range):
    "Fetch data for all the given attributes over the time range"
    # First get data from the DB and sort by y-axis
    futures = {}
    for attribute in attributes:
        # load data points for the attribute from the archive database
        name = attribute["name"].lower()
        call = partial(
            hdbpp.get_attribute_data,
            attr=name,
            start_time=time_range[0],
            end_time=time_range[1])
        # TODO: use the async functionality of cassandra-driver
        loop = asyncio.get_event_loop()
        futures[name] = loop.run_in_executor(None, call)

    # wait for all the attributes to be fetched
    await asyncio.gather(*futures.values())
    return {attribute["name"]: futures[attribute["name"]].result()
            for attribute in attributes}


def get_extrema(attributes, results, time_range, axes):
    "Get the max/min values for each attribute"
    per_axis = defaultdict(dict)
    for info in attributes:
        name = info["name"]
        periods = results[name]
        data = pandas.concat(periods, ignore_index=True)
        logging.debug("Length of %s: %d", name, len(data))

        # find local extrema
        y_axis = info["y_axis"]
        axis_config = axes.get(str(y_axis), {})

        # TODO: since we're shifting the data in make_image, we also
        # need to shift the window we use here, to get the extreme
        # points right. It feels bad to do this twice...
        t0, t1 = time_range
        utc_offset = (datetime.fromtimestamp(t0/1000) -
                      datetime.utcfromtimestamp(t0/1000)).total_seconds()
        relevant = data[(data["t"] >= time_range[0] - utc_offset*1000) &
                        (data["t"] <= time_range[1] - utc_offset*1000)]["v"].values

        if axis_config.get("scale") == "log":
            # ignore zero or negative values
            valid = np.take(relevant, np.where(relevant > 0)[0])
            value_min = valid.min()
            value_max = valid.max()
        else:
            value_max = relevant.max()
            value_min = relevant.min()

        per_axis[y_axis][name] = dict(
            data=data, info=info, points=len(relevant),
            y_range=(value_min, value_max))
    return per_axis


def get_axis_limits(y_axis, data):
    "Calculate the y limits for an axis"
    axis_min = axis_max = None
    nodata = set()
    for name, data in data.items():
        vmin, vmax = data["y_range"]
        if np.isnan(vmin) or np.isnan(vmax):
            # TODO: when will this actually happen?
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
    return axis_min, axis_max, nodata


def make_axis_images(per_axis, time_range, size, axes):

    "Create one image for each axis containing attributes"

    images = {}
    descs = {}
    for y_axis, attributes in per_axis.items():

        logging.debug("Computing data for axis %r %r",
                      y_axis, sorted(attributes.keys()))

        axis_min, axis_max, nodata = get_axis_limits(y_axis, attributes)

        if axis_min is None or axis_max is None:
            logging.debug("Could not calculate limits for axis %r!", y_axis)
            continue

        if np.isnan(axis_min) or np.isnan(axis_max):
            logging.debug("No data for axis %r!", y_axis)
            continue

        # calculate a reasonable range for the y axis
        scale = axes.get(str(y_axis), {}).get("scale")
        if axis_min == axis_max:
            # Looks like the value is constant so we can't derive
            # a range the normal way. Let's invent one instead.
            v = axis_min
            if v > 0:
                vmin = v / 2
                vmax = 1.5*v
            elif v == 0:
                vmin = -0.5
                vmax = 0.5
            else:
                vmin = 1.5*v
                vmax = v / 2
            y_range = (float(vmin), float(vmax))
        else:
            y_range = float(axis_min), float(axis_max)

        logging.debug("Axis %r has range %r", y_axis, y_range)

        # project the data into an image (using datashader)
        axis_images = []
        for name, data in attributes.items():
            if name in nodata:
                continue
            image, desc = make_image(data, time_range, y_range, size, scale)
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

    return images, descs
