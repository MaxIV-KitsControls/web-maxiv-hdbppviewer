import d3 from "d3";

import {debounce, parseAttribute} from "./utils"


const Y_AXIS_WIDTH = 0;  // how much horizontal room to reserve for each Y axis,
                           // to make room for tick labels

const Y_RANGE_PADDING = 0.05;  // how much room to leave above and below the
                               // lines, relative to the height

var customTimeFormat = d3.time.format.multi([
  [".%L", function(d) { return d.getMilliseconds(); }],
  [":%S", function(d) { return d.getSeconds(); }],
  ["%H:%M", function(d) { return d.getMinutes(); }],
  ["%H:00", function(d) { return d.getHours(); }],
  ["%a %d", function(d) { return d.getDay() && d.getDate() != 1; }],
  ["%b %d", function(d) { return d.getDate() != 1; }],
  ["%B", function(d) { return d.getMonth(); }],
  ["%Y", function() { return true; }]
]);


function closestIndex (num, arr) {
    let diff = num - arr[0];
        // index = -1;
    for (var val = 0; val < arr.length; val++) {
        let newdiff = num - arr[val];
        if (newdiff < 0) {
            if (-newdiff < diff)
                return val;
            else
                return val-1;
            diff = newdiff;
            // curr = arr[val];
            // index = val;
        }
    }
    return val-1;
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
        this.onChange = onChange
        this.runChangeCallback = debounce(this._runChangeCallback, 100);
        this.setSize();
        this.setUp(timeRange);
    }
    

    setUp(timeRange) {

        this.yScales = {}
        this.yAxes = {}
        this.yAxisElements = {}
        this.images = {};
        this.indicators = {};

        // Create the plot SVG element, using D3
        const svg = d3.select(this.containerElement)
              .append("svg")
              .attr("height", this.height)
              .attr("width", this.width)
        
        // scales
        this.x = d3.time.scale()
            .range([Y_AXIS_WIDTH, this.innerWidth])
            .domain(timeRange);

        this.zoom = d3.behavior.zoom()
            .x(this.x)
            .size([this.innerWidth, this.innerHeight])
            .on("zoom", this.zoomed.bind(this));

        this.container = svg.append("g")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")")
            .call(this.zoom)
        
        this.overlay = this.container.append("rect")
            .attr("class", "overlay")
            .attr("y", this.margin.top)
            .attr("width", this.innerWidth)
            .attr("height", this.innerHeight)

        // X axis
        this.xAxis = d3.svg.axis()
            .scale(this.x)
            .ticks(7)
            .orient("bottom")
            .tickSize(-this.innerHeight)
            .tickFormat(customTimeFormat);
        
        this.xAxisElement = this.container.append("g")
            .attr("class", "x axis")
            .attr("transform", "translate(0," + (this.innerHeight + this.margin.top) + ")")
            .call(this.xAxis);

        // clip the plot elements to the area within the axes
        this.clipRect = svg.append("defs")
            .append("svg:clipPath")
            .attr("id", "clip")
            .append("svg:rect")
            .attr("id", "clip-rect")
            .attr("width", this.innerWidth)
            .attr("height", this.innerHeight)

        this.clipBox = this.container.append("g")
            .attr("transform", `translate(${Y_AXIS_WIDTH},${this.margin.top})`)
            .attr("clip-path", "url(#clip)")
        
        this.inner = this.clipBox.append("g");

        // Y axes
        // TODO: should be pretty easy to support arbitrary numbers of
        // Y axes, mostly it's a matter of making room for them...
        
        this.addYAxis("linear")
        this.addYAxis("linear")                

        // vertical and horizontal lines showing the mouse position        
        this.crosshair = this.inner.append("svg:g")
            .classed("crosshair", true)
        
        this.crosshairLineX = this.crosshair.append("svg:line")
            .classed({cursor: true, x: true})
            .attr("y1", 0)
            .attr("y2", this.innerHeight)

        this.crosshairLabelX = this.crosshair
            .append("svg:text")
            .attr("y", this.innerHeight)
            .attr("dy", "-0.2em")
            .text("hej")
        
        this.crosshairLineY = this.crosshair
            .append("svg:line")
            .classed({cursor: true, x: true})
            .attr("x1", 0)
            .attr("x2", this.innerWidth)

        this.crosshairLabelY1 = this.crosshair
            .append("svg:text")
            .attr("x", Y_AXIS_WIDTH)
            .attr("dx", 2)
            .attr("dy", "-.2em")
            .style("text-anchor", "start")
            .text("hej")
        
        this.crosshairLabelY2 = this.crosshair
            .append("svg:text")
            .attr("x", this.innerWidth - Y_AXIS_WIDTH)
            .attr("dy", "-.2em")
            .attr("dx", -2)
            .style("text-anchor", "end")
            .text("hej")
                
        let [startTime, endTime] = this.x.domain()
        this.currentImage = 0
        this.imageTimeRanges = [this.x.domain(), this.x.domain()];

        // element that shows information about the point closest
        // to the mouse cursor
        this.descElement = d3.select(this.containerElement)
            .append("div")
            .classed("description", true)
            .style("display", "none")
            .text("hello");
        
    }

    addYAxis(scaleType) {
        const number = Object.keys(this.yAxes).length;
        const name = ""+number;

        const scale = d3.scale[scaleType]()
              .range([this.innerHeight + this.margin.top, this.margin.top])
              .domain([-1, 1])

        this.yScales[name] = scale;

        const axis = d3.svg.axis()
              .scale(scale)
              .ticks(5, ".1e")
              .orient(number % 2 === 0? "left" : "right")
              .tickSize(number % 2 === 0? -(this.innerWidth - Y_AXIS_WIDTH) : -5)

        this.yAxes[name] = axis;
            
        const element = this.container.append("g")
              .attr("class", "y axis")
              .attr("transform", "translate(" + (number % 2 === 0? 0 :
                                                 this.innerWidth ) + ",0)")
              .call(axis);

        this.yAxisElements[name] = element;

        // One image per axis, for displaying data
        // But, in fact we create two, to use for "double bufferint"
        // This is mostly a work-around to make image transitions smoother
        this.images[name] = [
            this.inner
                .append("svg:image")
                .attr("width", this.innerWidth - Y_AXIS_WIDTH)
                .attr("height", this.innerHeight),
            this.inner
                .append("svg:image")
                .attr("width", this.innerWidth - Y_AXIS_WIDTH)
                .attr("height", this.innerHeight)
        ];

        this.container
            .on("mousemove", this.showCrosshair.bind(this))
            .on("mouseleave", this.hideCrosshair.bind(this))

        return name;
        
    }
    
    removeYAxis(name) {
        delete this.yScales[name];
        delete this.yAxes[name];
        this.container.remove(this.yAxisElements[name])
        delete this.yAxisElements[name];
        // this.container.remove(this.images[name][0])
        // this.container.remove(this.images[name][1])
        // delete this.images[name];
    }

    setYAxisScale(yAxis, scaleType) {
        // const domain = this.yScales[yAxis].domain();
        const scale = d3.scale[scaleType]()
              .range([this.innerHeight + this.margin.top, this.margin.top])
        this.yScales[yAxis] = scale;
        const axis = this.yAxes[yAxis];
        axis.scale(scale);
        // this.yAxisElements[yAxis].call(axis)
        this.runChangeCallback();
    }
    
    setTimeRange(range) {
        this.x.domain(range);
        this.zoom.x(this.x)  // reset the zoom behavior
        this.zoomed()
    } 

    setConfig(config) {
        this.config = config;
    }
    
    setDescriptions(descriptions) {
        this.descriptions = descriptions;
    }

    // Given the (min, max) Y range of the data, return a (min', max') range
    // that covers the data Y range plus a visually consistent amount of padding.
    calculatePaddedYRange(yRange, log) {
        const [ymin, ymax] = yRange;
        if (log) {
            const height = Math.abs(Math.log10(ymax) - Math.log10(ymin)),
                  padding = ((height / (1 - 2*Y_RANGE_PADDING)) - height) / 2;            
            return [
                Math.pow(10, Math.log10(ymin) - padding),
                Math.pow(10, Math.log10(ymax) + padding)
            ]
        } else {
            const height = Math.abs(ymax - ymin),
                  padding = ((height / (1 - 2*Y_RANGE_PADDING)) - height) / 2;        
            return [ymin - padding, ymax + padding]
        }
    }

    showCrosshair() {
        const [mouseX, mouseY] = d3.mouse(this.clipBox.node());
        this.crosshairLineX
            .style("display", "block")
            .attr("x1", mouseX)
            .attr("x2", mouseX);
        this.crosshairLabelX
            .style({
                display: "block",
                "text-anchor": mouseX > (this.innerWidth / 2)? "end" : "start"
            })
            .attr("x", mouseX)
            .text(this.x.invert(mouseX).toLocaleString())
        this.crosshairLineY
            .style({
                display: "block",
            })
            .attr("y1", mouseY)
            .attr("y2", mouseY);
        this.crosshairLabelY1
            .style("display", "block")
            .attr("transform", "translate(0," + mouseY + ")")
            .text(d3.format(".2e")(this.yScales[0].invert(mouseY)))
        this.crosshairLabelY2
            .style("display", "block")
            .attr("transform", "translate(0," + mouseY + ")")
            .text(d3.format(".2e")(this.yScales[1].invert(mouseY)))
    }

    hideCrosshair() {
        this.crosshairLineX.style("display", "none")
        this.crosshairLineY.style("display", "none")        
        this.crosshairLabelX.style("display", "none")
        this.crosshairLabelY1.style("display", "none")
        this.crosshairLabelY2.style("display", "none")        
        
    }
    
    setData(data) {

        const axes = Object.keys(data);
        for (let axis of [0, 1]) {

            if (!data[axis]) {
                // If there's no data for the axis, it means that there
                // are no attributes on that axis. We'll just hide the
                // images from view.
                this.getImage(axis)
                    .attr("visibility", "hidden")
                this.getNextImage(axis)
                    .attr("visibility", "hidden")
                continue;
            }


            const {image, x_range, y_range} = data[axis];
            const [currentYMin, currentYMax] = this.yScales[axis].domain();
            const [yMin, yMax] = this.calculatePaddedYRange(y_range, !!this.yScales[axis].base);
            const yScale = (Math.abs(yMax - yMin) /
                            Math.abs(currentYMax - currentYMin));
            this.imageTimeRanges[(this.currentImage + 1) % 2] = x_range;            
            // Set the data of the "offscreen" image, and reset the
            // transform Is there a way to do this "atomically"? Maybe
            // use a canvas instead...
            this.yScales[axis].domain([yMin, yMax]);
            this.getNextImage(axis)
                // .attr("transform",
                //       `translate(${this.x(x_range[0])},${-this.margin.top})` +
                //       `scale(1,${yScale})`)
                .attr("xlink:href", "data:image/png;base64," + image)
                .attr("visibility", null)
                // .transition()
                .attr("transform", `translate(${this.x(x_range[0])},0)` +
                      `scale(1,1)`)

            this.yAxisElements[axis]
                .transition()
                .call(this.yAxes[axis])
            // TODO: the transitions should be synchronized
            
        }
        // Below is a hack; if we swap the images immediately, for
        // some reason the above changes have not always taken
        // place so the image will flicker.  Apparently, the image
        // update happens asynchronously and there seems to be no
        // way to hook into it. "onload" does not help.  One issue
        // is that the timeout is basically determined by manual
        // testing, ans may not always be enough.        
        if (this._swapTimeout) {
            // remove any previously set timeout.
            clearTimeout(this._swapTimeout);
        }
        this._swapTimeout = setTimeout(() => {
            // TODO: before swapping, make sure that we actually updated the
            // images! If not, we should show nothing.
            this.swapImage(),
            this._swapTimeout = null;
        }, 100)
        
    }
    
    setSize() {
        // calculate element dimensions
        let containerWidth = this.containerElement.offsetWidth;
        let pageHeight = window.innerHeight;
        const margin = this.margin = {top: 5, right: 70, bottom: 20, left: 70};
        this.width = containerWidth;
        this.height = pageHeight - 100;
        const width = this.width - margin.left - margin.right;
        const height = this.height - margin.top - margin.bottom;
        this.innerHeight = height;
        this.innerWidth = width;
    }

    updateTimeRange() {
        this.xAxisElement.call(this.xAxis);
        const [currentStartTime, currentEndTime] = this.x.domain(),
              [startTime, endTime] = this.imageTimeRanges[this.currentImage],
              scale = ((endTime - startTime) /
                       (currentEndTime.getTime() - currentStartTime.getTime()));
        for (let yAxis of Object.keys(this.yAxes)) {
            this.getImage(yAxis)
                .attr("transform", "translate(" + (this.x(startTime) -
                                                   Y_AXIS_WIDTH) +
                      ",0)scale("+ scale + ",1)");
        }        
    }
    
    zoomed() {
        // this.hideDescription();
        this.updateTimeRange();
        this.runChangeCallback();
    }

    swapImage() {
        // hide the current image for each axis and
        // show the other.
        let currentImage = this.currentImage,
            nextImage = (this.currentImage + 1) % 2
        for (let yAxis of Object.keys(this.yAxes)) {
            this.images[yAxis][nextImage]
                .attr("display", "inline")
            this.images[yAxis][currentImage]
                .attr("display", "none")
        }
        this.currentImage = nextImage;
    }

    getImage(yAxis) {
        // get the currently visible image for the axis
        return this.images[yAxis][this.currentImage];
    }

    getNextImage(yAxis) {
        // get the currently hidden image for the axis
        return this.images[yAxis][(this.currentImage + 1) % 2]
    }
    
    _runChangeCallback () {
        const [xStart, xEnd] = this.x.domain(),
              [xMin, xMax] = this.x.range(),
              [yMin, yMax] = this.yScales[0].range();
        const height = Math.abs(yMax - yMin);
        const padding = height * Y_RANGE_PADDING;
        this.onChange(xStart, xEnd, xMax - xMin, Math.floor(height - padding*2))
    }

}
