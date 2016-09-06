import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";

import {ImagePlot} from "./imageplot";
import {setTimeRange, fetchArchiveData} from "./actions";


class PlotWrapper extends React.Component {

    /* This is a "dummy" react component which acts as a container for
       the Plot, which is based on D3. */
    
    constructor() {
        super();
        this.state = {};
    }

    componentDidMount () {
        // create the SVG plot immediately, once
        let container = findDOMNode(this.refs.plot);
        this.plot = new ImagePlot(container, this.onChange.bind(this),
                                  new Date(Date.now() - 2*24*3600e3),
                                  new Date(Date.now() - 24*3600e3),
                                  "data_time", "value_r",
                                  500);
    }

    componentWillReceiveProps (props) {
        // update the plot as needed
        if (props.data != this.props.data) {
            let t0 = (new Date).getTime();            
            this.plot.setData(props.data);
            console.log("plottingn took", (new Date).getTime() - t0)
        }
        if (props.config != this.props.config) {
            this.plot.setConfig(props.config)
        }
        if (props.descriptions != this.props.descriptions) {
            this.plot.setDescriptions(props.descriptions);
        }
        const newRange = props.timeRange;
        const oldRange = this.props.timeRange;
        if (oldRange.start.getTime() != newRange.start.getTime() ||
            oldRange.end.getTime() != newRange.end.getTime()) {
            this.plot.setTimeRange([newRange.start.getTime(),
                                    newRange.end.getTime()]);
        }
    }

    shouldComponentUpdate () {
        // we never want to re-render the component; all updates
        // happen in the plot
        return false
    }
    
    render() {
        return <div className="plot-wrapper" ref="plot"></div>
    }

    onChange (start, end, width, height) {
        this.props.dispatch(setTimeRange(start, end));
        this.props.dispatch(fetchArchiveData(start, end, width, height));
    }
    
}

const mapStateToProps = (state) => {
    return {
        attributes: state.attributes,
        data: state.archiveData,
        config: state.config,
        descriptions: state.descriptions,
        timeRange: state.timeRange,
        config: state.attributeConfig
    }
}


export default connect(mapStateToProps)(PlotWrapper);
