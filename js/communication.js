import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { ButtonToolbar, Button, Input, Glyphicon } from 'react-bootstrap';
import { DateRange } from 'react-date-range';


class CommunicationInfo extends React.Component {
    render () {
        let msg;
        if (this.props.info.waitingForData) {
            msg = "Waiting for data..."
        } else if (this.props.info.receiveTime) {
            const elapsed = (this.props.info.receiveTime.getTime() -
                             this.props.info.fetchTime.getTime()) / 1000;
            msg = `Done in ${elapsed} s.`
        }
        return (
                <div style={{color: "#999", float: "right"}}>
                  {msg}
                </div>
        );
    }
}
    

const mapStateToProps = (state) => {
    return {
        info: state.communicationInfo
    }
}


export default connect(mapStateToProps)(CommunicationInfo);
    
