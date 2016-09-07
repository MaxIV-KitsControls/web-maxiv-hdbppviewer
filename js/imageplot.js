import d3 from "d3";

import {debounce} from "./utils"


const Y_AXIS_WIDTH = 0;  // how much horizontal room to reserve for each Y axis,
                           // to make room for tick labels

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


export class ImagePlot {

    constructor(containerElement, onChange) {
        this.containerElement = containerElement;
        this.onChange = onChange
        this.runChangeCallback = debounce(this._runChangeCallback,
                                          100);        

        this.setSize();
        this.setUp();

        // this.runChangeCallback()
    }

    setUp() {

        this.yScales = {}
        this.yAxes = {}
        this.yAxisElements = {}
        this.images = {};        
        
        const svg = d3.select(this.containerElement)
              .append("svg")
              .attr("height", this.height)
              .attr("width", this.width)
        
        // scales
        this.x = d3.time.scale()
            .range([Y_AXIS_WIDTH, this.innerWidth])
            .domain([new Date(Date.now() - 24*3600e3),
                     new Date(Date.now())]);

        
        this.zoom = d3.behavior.zoom()
            .x(this.x)
            .size([this.innerWidth, this.innerHeight])
            .on("zoom", this.zoomed.bind(this));

        this.container = svg.append("g")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")")
            .call(this.zoom)
        
        this.overlay = this.container.append("rect")
            .attr("class", "overlay")
            // .attr("x", Y_AXIS_WIDTH)
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
        
        this.inner = this.clipBox.append("g")
            // .attr("transform", `translate(${Y_AXIS_WIDTH},${this.margin.top})`)

        this.addYAxis()
        this.addYAxis()                
                
        let [startTime, endTime] = this.x.domain()
        this.currentImage = 0
        this.imageTimeRanges = [this.x.domain(), this.x.domain()];

        // this.zoom.y(this.yScales[0]);

        // this.cursorLineX = this.inner.append("svg:line")
        //     .classed({cursor: true, x: true})

        // this.cursorLineY = this.inner.append("svg:line")
        //     .classed({cursor: true, y: true})                
        
        
        this.descElement = d3.select(this.containerElement)
            .append("div")
            .classed("description", true)
            .style("display", "none")
            .text("hello");
        
    }

    addYAxis() {
        const number = Object.keys(this.yAxes).length;
        console.log("addYAxis", number);
        const name = ""+number;

        const scale = d3.scale.linear()
            .range([this.innerHeight + this.margin.top, this.margin.top])
            .domain([-1, 1])

        this.yScales[name] = scale;

        const axis = d3.svg.axis()
              .scale(scale)
              .ticks(5)
              .orient(number % 2 === 0? "left" : "right")
              .tickSize(number % 2 === 0? -(this.innerWidth - Y_AXIS_WIDTH) : -5)
              .tickFormat(d3.format(".1e"))

        this.yAxes[name] = axis;
            
        const element = this.container.append("g")
              .attr("class", "y axis")
              .attr("transform", "translate(" + (number % 2 === 0? 0 : this.innerWidth ) + ",0)")
              .call(axis);

        this.yAxisElements[name] = element;

        this.images[name] = [
            this.inner
                .append("svg:image")
                .attr("width", this.innerWidth - Y_AXIS_WIDTH)
                .attr("height", this.innerHeight)
                .style("fill", "yellow")
                .on("mousemove", () => this.showDescription())
                .on("mouseenter", () => this.showDescription())
                .on("mouseleave", () => this.hideDescription()),
            this.inner
                .append("svg:image")
                // .attr("opacity", 0.5)
                // .attr("display", "none")
                .attr("width", this.innerWidth - Y_AXIS_WIDTH)
                .attr("height", this.innerHeight)
                .on("mousemove", () => this.showDescription())
                .on("mouseenter", () => this.showDescription())
                .on("mouseleave", () => this.hideDescription())            
        ];

        return name;
        
    }
    
    showDescription() {
        // TODO: this is just a dirty hack to demo the functionality,
        // it needs to be redone in a proper way.
        const [x, y] = d3.mouse(this.inner.node());
        [Object.keys(this.descriptions)[0]].forEach((attr) => {
            const i = Math.round(x),
                  desc = this.descriptions[attr],
                  max = desc.max[i], min = desc.min[i],
                  color = this.config[attr].color;
            this.descElement
                .style("display", "block")
                .style("left", this.margin.left + i + 10)
                .style("bottom", this.innerHeight - (max? this.yScales[0](max) : y) + 40)
                .html(`<b style="color:${color};">${attr}</b><br>Max: ${max}<br>Min: ${min}`)

            // this.cursorLineX
            //     .style("display", "block")            
            //     .attr("x1", i+.5)
            //     .attr("y1", this.yScales[0](0))
            //     .attr("x2", i+.5)
            //     .attr("y2", this.yScales[0](min));

            // const ymin = this.yScales[0](min),
            //       ymax = this.yScales[0](max);
            // const width = Math.abs(ymax - ymin);
            
            // this.cursorLineY
            //     .style("display", "block")
            //     .attr("x1", 0)
            //     .attr("y1", ymin - width/2)
            //     .attr("x2", i)
            //     .attr("y2", ymin - width/2)
            //     .style("stroke-width", width)
        })
    }

    hideDescription() {
        this.descElement
            .style("display", "none")
        // this.cursorLineY
        //     .style("display", "none")            
        // this.cursorLineX
        //     .style("display", "none")            
    }
    
    removeYAxis(name) {
        delete this.yScales[name];
        delete this.yAxes[name];
        this.container.remove(this.yAxisElements[name])
        delete this.yAxisElements[name];
        this.container.remove(this.images[name][0])
        this.container.remove(this.images[name][1])
        delete this.images[name];
    }

    setTimeRange(range) {
        this.x.domain(range)
        this.zoom.x(this.x)  // reset the zoom behavior
        this.zoomed()
    }

    setConfig(config) {
        this.config = config;
    }
    
    setDescriptions(descriptions) {
        this.descriptions = descriptions;
    }
    
    setData(data) {
        const axes = Object.keys(data);
        for (let axis of axes) {
            const {image, x_range, y_range} = data[axis],
                  [currentYMin, currentYMax] = this.yScales[axis].domain(),
                  [yMin, yMax] = y_range,
                  yScale = (Math.abs(yMax - yMin) /
                            Math.abs(currentYMax - currentYMin));
            this.imageTimeRanges[(this.currentImage + 1) % 2] = x_range;            
            // Set the data of the "offscreen" image, and reset the
            // transform Is there a way to do this "atomically"? Maybe
            // use a canvas instead...
            this.getNextImage(axis)
                .attr("transform",
                      `translate(${this.x(x_range[0])},${this.yScales[axis](yMax)-this.margin.top})` +
                      `scale(1,${yScale})`)
                .attr("xlink:href", "data:image/png;base64," + image)
                .transition()
                .attr("transform", `translate(${this.x(x_range[0])},0)` +
                      `scale(1,1)`)
            this.yScales[axis].domain(data[axis].y_range);            
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
        const margin = this.margin = {top: 5, right: 50, bottom: 20, left: 50};
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
              scale = (endTime - startTime) / (currentEndTime.getTime() - currentStartTime.getTime());
        for (let yAxis of Object.keys(this.yAxes)) {
            this.getImage(yAxis)
                .attr("transform", "translate(" + (this.x(startTime) - Y_AXIS_WIDTH) + ",0)scale("+ scale + ",1)");
        }        
    }
    
    zoomed() {
        this.hideDescription();
        this.updateTimeRange();
        this.runChangeCallback();
    }

    swapImage() {
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
        return this.images[yAxis][this.currentImage];
    }

    getNextImage(yAxis) {
        return this.images[yAxis][(this.currentImage + 1) % 2]
    }
    
    _runChangeCallback () {
        const [xStart, xEnd] = this.x.domain(),
              [xMin, xMax] = this.x.range(),
              [yMin, yMax] = this.yScales[0].range();
        this.onChange(xStart, xEnd, xMax - xMin, yMin - yMax)
    }
    
    
}
