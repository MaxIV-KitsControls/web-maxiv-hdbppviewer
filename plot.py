import base64
from collections import defaultdict
from datetime import datetime
import io
import logging
from math import log10
import time

import datashader
import numpy as np

from utils import timer


def make_image(data, time_range, y_range, size, scale=None, width=0):

    "Flatten the given range of the data into a 2d image"
    time_range = (
        time_range[0].timestamp()*1e6,
        time_range[1].timestamp()*1e6
    )
    cvs = datashader.Canvas(x_range=time_range, y_range=y_range,
                            plot_width=size[0], plot_height=size[1],
                            y_axis_type=scale or "linear")

    # aggregate some useful measures
    agg_line = cvs.line(source=data["data"], x="t", y="value_r")
    agg_points = cvs.points(source=data["data"], x="t", y="value_r",
                            agg=datashader.summary(
                                count=datashader.count("value_r"),
                                vmean=datashader.mean("value_r"),
                                vmin=datashader.min("value_r"),
                                vmax=datashader.max("value_r")))
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


def get_extrema(attributes, results, time_range, axes):
    "Get the max/min values for each attribute"
    per_axis = defaultdict(dict)
    t0, t1 = time_range
    for info in attributes:
        name = info["name"]
        data = results[name]
        logging.debug("Length of %s: %d", name, len(data))

        # find local extrema
        y_axis = info["y_axis"]
        axis_config = axes.get(str(y_axis), {})
        # we have to assume that we have more data than the time_range
        # requested, so we'll make a slice containing only the relevant part
        i0, = data["t"].searchsorted(t0.timestamp() * 1e6)  # t is in µs!
        i1, = data["t"].searchsorted(t1.timestamp() * 1e6)
        relevant = data[i0:i1]
        
        with timer("getting max/min"):
            if axis_config.get("scale") == "log":
                # ignore zero or negative values b/c they make no sense
                valid = relevant.where(relevant > 0)
                value_min = valid["value_r"].min()
                value_max = valid["value_r"].max()
            else:
                value_max = relevant["value_r"].max()
                value_min = relevant["value_r"].min()
        #check if the axis contain range values; if it does set those and if not use the default
        if len(axes.keys()):
            value_min = float(axes[str(y_axis)].get("min", value_min))
            value_max = float(axes[str(y_axis)].get("max", value_max))

        per_axis[y_axis][name] = dict(
            data=data, info=info, points=len(relevant),
            y_range=(value_min,value_max))
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
            # TODO: this may happen because the view is between two
            # points, neither one within sight. Datashader can draw a
            # line anyway, so it might be worth checking this case. I
            # guess just checking if there is a point on either side
            # might be good enough, but it will still fail if any of
            # the points is in a different period.
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
            # TODO: I haven't put much thought into this, there might
            # be a better way. Does it work OK with log axes?
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
            # calculate some padding to add above and below the plot, for
            # visual reasons (e.g. don't want the line to overlap the x axis)
            if scale == "log":
                logmax = log10(axis_max)
                logmin = log10(axis_min)
                padding = 0.05 * (logmax - logmin)
                y_range = 10**(logmin - padding), 10**(logmax + padding)
            else:
                padding = 0.05 * (axis_max - axis_min)
                y_range = float(axis_min - padding), float(axis_max + padding)

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
            "x_range": [time_range[0].timestamp()*1000,
                        time_range[1].timestamp()*1000]
        }
        # TODO: also grab configuration, e.g. label, unit, ...
        # Note that this can also change over time!

    return images, descs
