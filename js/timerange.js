import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { ButtonToolbar, Button, Input, Glyphicon } from 'react-bootstrap';
import { DateRange } from 'react-date-range';
import moment from 'moment';

import {setTimeRange} from "./actions";


const defaultRanges = {
    'Today': {
        startDate: function startDate(now) {
            return now;
        },
        endDate: function endDate(now) {
            return now;
        }
    },

    'Yesterday': {
        startDate: function startDate(now) {
            return now.add(-1, 'days');
        },
        endDate: function endDate(now) {
            return now.add(-1, 'days');
        }
    },

    'Last 7 Days': {
        startDate: function startDate(now) {
            return now.add(-7, 'days');
        },
        endDate: function endDate(now) {
            return now;
        }
    },

    'Last 30 Days': {
        startDate: function startDate(now) {
            return now.add(-30, 'days');
        },
        endDate: function endDate(now) {
            return now;
        }
    }
}


class TimeRange extends React.Component {

    constructor (props) {
        super();
        this.state = {
            show: false,
            startDate: moment(props.timeRange.start),
            endDate: moment(props.timeRange.end)
        }
    }
    
    handleSelect (range) {
	this.setState(range);
    }

    handleApply() {
        this.props.dispatch(setTimeRange(this.state.startDate.toDate(),
                                         this.state.endDate.toDate()));
        this.setState({show: false})
    }

    handleShow() {
        this.setState({show: !this.state.show})
    }
    
    render () {

        const startDate = this.props.timeRange.start.toDateString(),
              endDate = this.props.timeRange.end.toDateString();
        const dateString = (startDate == endDate?
                            startDate :
                            startDate + " - " + endDate);
        /* TODO: the calendar popup is done in a pretty primitive way,
           but I could not get the bootstrap Overlay stuff to work with
           proper positioning. Might be worth looking into at some point. */
        const dateRange = (
                <div style={{position: "absolute",
                             width: "800px", padding: "10px",
                             borderRadius: "5px", background: "white",
                             display: this.state.show? "block" : "none",
                             zIndex: "100",
                             right: "10px"}}>
                  <DateRange startDate={moment(this.props.timeRange.start)}
                             endDate={moment(this.props.timeRange.end)}
                             onChange={this.handleSelect.bind(this)}
                             ranges={defaultRanges}
                             theme= {{Calendar : {width : '300px',
                                                  padding : '10px 9px'}}}/>
                  <ButtonToolbar>
                    <Button bsStyle="success" title="Plot the selected range"
                            onClick={this.handleApply.bind(this)}>Apply</Button>
                    <Button bsStyle="danger"
                            title="Close the calendar withput changes"
                            onClick={this.handleShow.bind(this)}>Cancel</Button>
                  </ButtonToolbar>
            </div>);

        return (<div ref="trigger">
                  <Button  onClick={this.handleShow.bind(this)}
                           active={this.state.show}
                           title="Click to manually select a range of dates">
                    <span className="pull-left"><Glyphicon glyph="calendar"/>
                    </span>
                    <span style={{whiteSpace: "nowrap"}}>
                      {dateString}
                    </span>
                  </Button>
                  {dateRange}
                </div>);
    }    
}


const mapStateToProps = (state) => {
    return {
        timeRange: state.timeRange,
        details: state.details
    }
}


export default connect(mapStateToProps)(TimeRange);
