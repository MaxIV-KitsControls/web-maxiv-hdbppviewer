import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { Button, Input, Glyphicon } from 'react-bootstrap';
import moment from 'moment';

import {setTimeRange} from "./actions";


// class TimeRange extends React.Component {
    
//     constructor () {
//         super();
//         this.state = {
// 	    ranges: {
// 		'Today': [moment(), moment()],
// 		'Yesterday': [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
// 		'Last 7 Days': [moment().subtract(6, 'days'), moment()],
// 		'Last 30 Days': [moment().subtract(29, 'days'), moment()],
// 		'This Month': [moment().startOf('month'), moment().endOf('month')],
// 		'Last Month': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')]
// 	    },
// 	    startDate: moment().subtract(29, 'days'),
// 	    endDate: moment()
// 	}
//     }
    
//     handleEvent (event, picker) {
// 	this.props.dispatch(setTimeRange(
// 	    picker.startDate,
// 	    picker.endDate));
//     }
    
//     render () {
//         return (
// 	        <DateRangePicker
//                     timePicker={true}
//                     startDate={this.props.startTime}
//                     endDate={this.props.endTime}
//                     ranges={this.state.ranges}
//                     onEvent={this.handleEvent.bind(this)}>
// 		<Button className="selected-date-range-btn" style={{width:'100%'}}>
// 		<div className="pull-left"><Glyphicon glyph="calendar" /></div>
// 		<div className="pull-right">
// 		<span>
// 		Time range
//                 </span>
// 		<span className="caret"></span>
// 		</div>
// 		</Button>
//                 </DateRangePicker>
// 	)
//     }
// }


class _TimeRange2 extends React.Component {

    render () {
        return (<table style={{width: "100%"}} className="time-range">
                  <tbody>
                    <tr>
                      <td>
                        {this.props.startTime.toLocaleString()}
                </td>
                <td>
                <DatetimeRangePicker
                  timePicker
                  timePicker24Hour
                  startDate={moment("2016-07-01")}
                  endDate={moment("2016-08-01")}>

                <input type="text" value="hej"/>
                <span className="input-group-btn">
                    <Button className="default date-range-toggle">
                      <i className="fa fa-calendar"/>
                    </Button>
                </span>                
                </DatetimeRangePicker>
                </td>
                      <td style={{textAlign: "right"}}>
                        {this.props.endTime.toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>);
    }
    
}


class TimeRange2 extends React.Component {

    componentDidMount() {
        const element = findDOMNode(this.refs.range);
        console.log("flepp", element);
        this.picker = $(element).daterangepicker(
            {
                timePicker: true,
                timePicker24Hour: true,
                timePickerIncrement: 30,
                locale: {
                    format: 'MM/DD/YYYY h:mm A'
                },
                drops: "down",
                opens: "left"
            },
            this.onChange.bind(this)
        );
    }

    onChange(start, end) {
        console.log("range", start, end)
        this.props.dispatch(setTimeRange(start._d, end._d))
    }

    setTimeRange(range) {
        const [startTime, endTime] = range;
        this.picker.setStartDate(startTime);
        this.picker.setEndDate(endTime);
    }
    
    shouldComponentUpdate() {
        return false;
    }
    
    render () {
        return <div ref="range">Date range</div>
    }
    
}


const mapStateToProps = (state) => {
    return {
        startTime: state.timeRange.start,
        endTime: state.timeRange.end,
        details: state.details
    }
}


export default connect(mapStateToProps)(TimeRange2);
