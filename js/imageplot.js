/*
The data flow in this code is a little complex, especially since parts of it are async,
so here is a summary:

* We start by creating an ImagePlot instance. When it receives data (via setData) it will
send the data to one instance of YAxisImage per y-axis (currently there are always two
y-axes).

* The YAxisImage in turn creates an AttributeImage instance per attribute in the
data.

* Each AttributeImage instance will load the encoded attribute data, and then draw it
according to its settings (color, thickness, ...) onto an internal canvas. When done
it will signal the YAxisImage.

* YAxisImage waits for all the AttributeImages to be done drawing, and then draws them
all into a combined canvas. It then finally signals the ImagePlot instance.

* ImagePlot now loads the final image into the SVG image element for the corresponding
y-axis, and updates the axes.

This all may seem overly complicated, but the point of it is that it makes it possible
to reconfigure the plot without going all the way to the server. E.g. changing the color
of a line or toggling visibility only requires re-rendering the canvas, which is all done
in the browser.
*/

import { debounce, parseAttribute } from "./utils";

import * as d3 from "d3";

class AttributeImage {
    /*
      Manage an image for one attribute. The "raw" image received from
      the server does not have color or other configuration so we need
      to render it to an internal canvas using the proper
      settings. This can then be rendered to the main canvas.
     */

    constructor(name, callback) {
        this.name = name;
        this.config = {};
        this.image = new Image();
        this.image.addEventListener("load", this.draw.bind(this));
        this.canvas = document.createElement("canvas");
        this.updatedCallback = callback;
    }

    load(encodedImage) {
        // Note that image loading may be asynchronous, so we have to use
        // an event callback in order to be sure that it's finished loading
        // before we can use it, even though we already have the data.
        this.image.src = encodedImage;
    }

    draw() {
        this.canvas.width = this.image.width;
        this.canvas.height = this.image.height;
        const context = this.canvas.getContext("2d");

        // Some canvas trickery to render the image in the configured color
        context.fillStyle = this.config.color || "red";
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        context.globalCompositeOperation = "destination-in";
        context.drawImage(this.image, 0, 0);
        context.globalCompositeOperation = "source-over";

        if (this.config.width === 2) {
            // simulate thick lines by redrawing it several times with offset
            context.drawImage(this.canvas, 1, 0);
            context.drawImage(this.canvas, 0, 1);
        }
        if (this.updatedCallback) this.updatedCallback(this.name);
    }
}

class YAxisImage {

    /* This is a container for all the "raw" curve images received
      from the backend for an y axie. It takes care of rendering them all into an
      internal canvas. */

    constructor(callback) {
        this.callback = callback;
        this.canvas = document.createElement("canvas");
        this.context = this.canvas.getContext("2d");
        this.attributeConfigs = [];
        this.attributeDescs = {};
        this.attributeImages = {};
        this.attributesWaitingForUpdate = null;
    }

    setSize(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.context = this.canvas.getContext("2d");
    }

    getAttribute(attrName) {
        if (attrName in this.attributeImages) {
            return this.attributeImages[attrName];
        } else {
            return new AttributeImage(
                attrName,
                this.attributeImageUpdated.bind(this)
            );
        }
    }

    attributeImageUpdated(attrName) {
        this.attributesWaitingForUpdate.delete(attrName);
        // Since image loading may happen asynchronously, let's just
        // wait until we have received callbacks for every one before
        // drawing anything.
        if (this.attributesWaitingForUpdate.size === 0) {
            this.attributesWaitingForUpdate = null;
            this.draw();
        }
    }

    setConfigs(configs) {
        this.attributeConfigs = configs;
    }

    setXRange(range) {
        this.x_range = range;
    }

    setData(data) {
        const newAttributeImages = {};
        this.attributesWaitingForUpdate = new Set();
        // TODO We should get the attributes as a list instead, since
        // the images should be drawn in consistent order.
        Object.entries(this.attributeConfigs).forEach(
            ([attrName, attrConfig]) => {
                const attrData = data[attrName];
                this.attributeDescs[attrName] = attrData.desc;
                const attrImg = this.getAttribute(attrName);
                attrImg.config = attrConfig;
                attrImg.load(attrData.image);
                newAttributeImages[attrName] = attrImg;
                this.attributesWaitingForUpdate.add(attrName);
            }
        );
        this.attributeImages = newAttributeImages;
    }

    // Render all the attribute images onto an internal canvas.
    draw() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        Object.entries(this.attributeConfigs).forEach(
            ([attrName, attrConfig]) => {
                const attrImg = this.attributeImages[attrName];
                this.context.drawImage(attrImg.canvas, 0, 0);
            }
        );
        this.callback(this);
    }
}

const Y_AXIS_WIDTH = 0; // how much horizontal room to reserve for each Y axis,
// to make room for tick labels

var formatMillisecond = d3.timeFormat(".%L"),
    formatSecond = d3.timeFormat(":%S"),
    formatMinute = d3.timeFormat("%H:%M"),
    formatHour = d3.timeFormat("%H:00"),
    formatDay = d3.timeFormat("%a %d"),
    formatWeek = d3.timeFormat("%b %d"),
    formatMonth = d3.timeFormat("%B"),
    formatYear = d3.timeFormat("%Y");

// Define filter conditions
function customTimeFormat(date) {
    return (d3.timeSecond(date) < date
        ? formatMillisecond
        : d3.timeMinute(date) < date
            ? formatSecond
            : d3.timeHour(date) < date
                ? formatMinute
                : d3.timeDay(date) < date
                    ? formatHour
                    : d3.timeMonth(date) < date
                        ? d3.timeWeek(date) < date ? formatDay : formatWeek
                        : d3.timeYear(date) < date ? formatMonth : formatYear)(
        date
    );
}

function closestIndex(num, arr) {
    let diff = num - arr[0];
    // index = -1;
    for (var val = 0; val < arr.length; val++) {
        let newdiff = num - arr[val];
        if (newdiff < 0) {
            if (-newdiff < diff) return val;
            else return val - 1;
            diff = newdiff;
            // curr = arr[val];
            // index = val;
        }
    }
    return val - 1;
    // return index;
}

export class ImagePlot {
    /*
      This is the main plot widget, showing the data for all added
      attributes over the selected time range.

      It works by requesting bitmap images (!) from the server, one
      per y-axis. The idea is that sending all the points to the
      browser to be plotted using JS does not scale indefinitely. The
      the data can easily go into millions of points for some months
      of data.

      Instead, loading the data as encoded PNG images uses reasonable
      bandwidth, typically less than 100k per request, and does not depend
      on the time window size or number of attributes. It does depend
      on the screen resolution but PNG is a reasonable encoding for
      this type of images.

      We also receive some metadata from the server, providing mouse
      hover information, and this is usually comparable or larger than
      the images themselves. This is done in a pretty inefficient way
      ATM. Perhaps the hover info could be loaded more asynchronously.
     */

    constructor(containerElement, timeRange, onChange) {
        this.containerElement = containerElement;
        this.onChange = onChange;
        this.runChangeCallback = debounce(this._runChangeCallback, 100);
        this.setSize();
        this.setUp(timeRange);
    }

    setUp(timeRange) {
        this.yScales = {};
        this.yAxes = {};
        this.yAxisElements = {};
        this.images = {};
        this.yAxisImages = {};
        this.indicators = {};

        // Create the plot SVG element, using D3
        this.svg = d3
            .select(this.containerElement)
            .append("svg")
            .attr("height", this.height)
            .attr("width", this.width);

        // scales
        this.x = d3
            .scaleTime()
            .range([Y_AXIS_WIDTH, this.innerWidth])
            .domain(timeRange);

        this.newXScale;

        this.zoom = d3.zoom().on("zoom", this.zoomed.bind(this));

        this.container = this.svg
            .append("g")
            .classed("container", true)
            .attr(
                "transform",
                "translate(" + this.margin.left + "," + this.margin.top + ")"
            );
        this.container.call(this.zoom);

        this.overlay = this.container
            .append("rect")
            .attr("class", "overlay")
            .attr("y", this.margin.top)
            .attr("width", this.innerWidth)
            .attr("height", this.innerHeight);

        // X axis
        this.xAxis = d3
            .axisBottom()
            .scale(this.x)
            .ticks(7)
            .tickSize(-this.innerHeight)
            .tickFormat(customTimeFormat);

        this.xAxisElement = this.container
            .append("g")
            .attr("class", "x axis")
            .attr(
                "transform",
                "translate(0," + (this.innerHeight + this.margin.top) + ")"
            )
            .call(this.xAxis);

        // clip the plot elements to the area within the axes
        this.clipRect = this.svg
            .append("defs")
            .append("svg:clipPath")
            .attr("id", "clip")
            .append("svg:rect")
            .attr("id", "clip-rect")
            .attr("width", this.innerWidth)
            .attr("height", this.innerHeight);

        this.clipBox = this.container
            .append("g")
            .attr("transform", `translate(${Y_AXIS_WIDTH},${this.margin.top})`)
            .attr("clip-path", "url(#clip)");

        this.inner = this.clipBox.append("g");

        // Y axes
        // TODO: should be pretty easy to support arbitrary numbers of
        // Y axes, mostly it's a matter of making room for them...

        this.addYAxis("linear");
        this.addYAxis("linear");

        // vertical and horizontal lines showing the mouse position
        this.crosshair = this.inner.append("g").classed("crosshair", true);

        this.crosshairLineX = this.crosshair.append("line");

        this.crosshairLineX
            .attr("class", "cursor x")
            .attr("y1", 0)
            .attr("y2", this.innerHeight);

        this.crosshairLabelX = this.crosshair
            .append("svg:text")
            .attr("y", this.innerHeight)
            .attr("dy", "-0.2em");

        this.crosshairLineY = this.crosshair
            .append("svg:line")
            .attr("class", "cursor x")
            .attr("x1", 0)
            .attr("x2", this.innerWidth);

        this.crosshairLabelY1 = this.crosshair
            .append("svg:text")
            .attr("x", Y_AXIS_WIDTH)
            .attr("dx", 2)
            .attr("dy", "-.2em")
            .style("text-anchor", "start")
            .text("hej");

        this.crosshairLabelY2 = this.crosshair
            .append("svg:text")
            .attr("x", this.innerWidth - Y_AXIS_WIDTH)
            .attr("dy", "-.2em")
            .attr("dx", -2)
            .style("text-anchor", "end")
            .text("hej");
        const auxDomain = this.newXScale
            ? this.newXScale.domain()
            : this.x.domain();
        let [startTime, endTime] = auxDomain;
        this.currentImage = 0;
        this.imageTimeRanges = [auxDomain, auxDomain];

        // element that shows information about the point closest
        // to the mouse cursor
        this.descElement = d3
            .select(this.containerElement)
            .append("div")
            .classed("description", true)
            .style("display", "none")
            .text("hello");


    }

    addYAxis(scaleType) {
        const number = Object.keys(this.yAxes).length;
        const name = "" + number;

        if (scaleType === "linear") {
            var scale = d3
                .scaleLinear()
                .range([this.innerHeight + this.margin.top, this.margin.top])
                .domain([-1, 1]);
        } else {
            var scale = d3
                .scaleLog()
                .range([this.innerHeight + this.margin.top, this.margin.top])
                .domain([-1, 1]);
        }

        this.yScales[name] = scale;

        if (number % 2 === 0) {
            var axis = d3
                .axisLeft()
                .scale(scale)
                .ticks(5, ".1e")
                .tickSize(
                    number % 2 === 0 ? -(this.innerWidth - Y_AXIS_WIDTH) : -5
                );
        } else {
            var axis = d3
                .axisRight()
                .scale(scale)
                .ticks(5, ".1e")
                .tickSize(
                    number % 2 === 0 ? -(this.innerWidth - Y_AXIS_WIDTH) : -5
                );
        }

        this.yAxes[name] = axis;

        const element = this.container
            .append("g")
            .attr("class", "y axis")
            .attr(
                "transform",
                "translate(" + (number % 2 === 0 ? 0 : this.innerWidth) + ",0)"
            )
            .call(axis);

        this.yAxisElements[name] = element;

        // One image per axis, for displaying data
        // But, in fact we create two, to use for "double buffering"
        // This is mostly a work-around to make image transitions smoother
        this.images[name] = this.inner
            .append("svg:image")
            .attr("width", this.innerWidth - Y_AXIS_WIDTH)
            .attr("height", this.innerHeight);

        this.yAxisImages[name] = new YAxisImage(
            this.updateImage.bind(this, name)
        );

        this.container
            .on("mousemove", this.showCrosshair.bind(this))
            .on("mouseleave", this.hideCrosshair.bind(this));

        return name;
    }

    updateImage(axis, yAxisImage) {
        const svgImage = this.images[axis].node();
        function callback () {
            // Since the image is decoded asynchronously, we can avoid some flicker by
            // waiting with resetting the transform until after it's done.
            svgImage.setAttribute("transform", "");
            this.imageTimeRanges[0] = yAxisImage.x_range
            svgImage.removeEventListener('load', callback);
        }
        svgImage.addEventListener("load", callback.bind(this));

        // TODO this seems pretty inefficient but might be OK since the images are small.
        // Also, this is only done once per data load which typically takes lots of
        // time anyway.
        svgImage.setAttributeNS('http://www.w3.org/1999/xlink',
                                "xlink:href", yAxisImage.canvas.toDataURL());
    }

    removeYAxis(name) {
        delete this.yScales[name];
        delete this.yAxes[name];
        this.container.remove(this.yAxisElements[name]);
        delete this.yAxisElements[name];
    }

    setYAxisScale(yAxis, scaleType) {
        if (scaleType === "linear") {
            var scale = d3
                .scaleLinear()
                .range([this.innerHeight + this.margin.top, this.margin.top]);
        } else {
            var scale = d3
                .scaleLog()
                .range([this.innerHeight + this.margin.top, this.margin.top]);
        }

        this.yScales[yAxis] = scale;
        const axis = this.yAxes[yAxis];
        axis.scale(scale);
        this.runChangeCallback();
    }

    setTimeRange(range) {
        this.x.domain(range);
        this.xAxisElement.call(this.zoom.transform, d3.zoomIdentity);
        this.zoomed();
    }

    setConfig(config) {
        this.config = config;
    }

    setDescriptions(descriptions) {
        this.descriptions = descriptions;
    }

    showCrosshair() {
        const [mouseX, mouseY] = d3.mouse(this.clipBox.node());
        var mouseXText = this.newXScale
            ? this.newXScale.invert(mouseX).toLocaleString()
            : this.x.invert(mouseX).toLocaleString();
        this.crosshairLineX
            .attr("display", "block")
            .attr("x1", mouseX)
            .attr("x2", mouseX);
        this.crosshairLabelX
            .attr("display", "block")
            .attr("text-anchor", mouseX > this.innerWidth / 2 ? "end" : "start")
            .attr("x", mouseX)
            .text(mouseXText);
        this.crosshairLineY
            .attr("display", "block")
            .attr("y1", mouseY)
            .attr("y2", mouseY);
        this.crosshairLabelY1
            .attr("display", "block")
            .attr("transform", "translate(0," + mouseY + ")")
            .text(d3.format(".2e")(this.yScales[0].invert(mouseY)));
        this.crosshairLabelY2
            .attr("display", "block")
            .attr("transform", "translate(0," + mouseY + ")")
            .text(d3.format(".2e")(this.yScales[1].invert(mouseY)));
    }

    hideCrosshair() {
        this.crosshairLineX.attr("display", "none");
        this.crosshairLineY.attr("display", "none");
        this.crosshairLabelX.attr("display", "none");
        this.crosshairLabelY1.attr("display", "none");
        this.crosshairLabelY2.attr("display", "none");
    }

    setData(data) {
        const axes = Object.keys(data);
        let axisConfigs = {};
        Object.entries(this.config).forEach(([attr, conf]) => {
            if (!axisConfigs[conf.axis]) {
                axisConfigs[conf.axis] = {};
            }
            axisConfigs[conf.axis][attr] = conf;
        });
        Object.entries(axisConfigs).forEach(([axis, confs]) => {
            const yAxisImage = this.yAxisImages[axis];
            yAxisImage.setConfigs(confs);
            yAxisImage.setXRange(data.y_axes[axis].x_range)
            yAxisImage.setSize(this.innerWidth, this.innerHeight)
            yAxisImage.setData(data.attributes)
            const scale = this.yScales[axis];
            scale.domain(data.y_axes[axis].y_range)
            this.yAxes[axis].scale(scale)
            this.yAxisElements[axis]
                .transition()
                .call(this.yAxes[axis])
        });
    }

    setSize() {
        // calculate element dimensions
        let containerWidth = this.containerElement.offsetWidth;
        let pageHeight = window.innerHeight;
        const margin = (this.margin = {
            top: 5,
            right: 70,
            bottom: 20,
            left: 70
        });
        this.width = containerWidth;
        this.height = pageHeight - 200;
        const width = this.width - margin.left - margin.right;
        const height = this.height - margin.top - margin.bottom;
        this.innerHeight = height;
        this.innerWidth = width;
    }

    updateTimeRange() {
        this.newXScale = d3.event
            ? d3.event.transform.rescaleX(this.x)
            : this.x;
        this.xAxisElement.call(this.xAxis.scale(this.newXScale));

        const [currentStartTime, currentEndTime] = this.newXScale.domain(),
            [startTime, endTime] = this.imageTimeRanges[this.currentImage],
            scale =
                (endTime - startTime) /
                (currentEndTime.getTime() - currentStartTime.getTime());

        for (let yAxis of Object.keys(this.yAxes)) {
            this.images[yAxis].attr(
                "transform",
                "translate(" +
                    (this.newXScale(startTime) - Y_AXIS_WIDTH) +
                    ",0)scale(" +
                    scale +
                    ",1)"
            );
        }
    }

    zoomed() {
        this.updateTimeRange();
        this.runChangeCallback();
    }

    _runChangeCallback() {
        const [xStart, xEnd] = this.newXScale
                ? this.newXScale.domain()
                : this.x.domain(),
            [xMin, xMax] = this.x.range(),
            [yMin, yMax] = this.yScales[0].range();
        const height = Math.abs(yMax - yMin);
        this.onChange(xStart, xEnd, xMax - xMin, height);
    }
}
