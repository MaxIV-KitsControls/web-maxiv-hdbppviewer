import React from "react";
import { findDOMNode } from "react-dom";
import { connect } from "react-redux";
import { ButtonToolbar, Button, Input, Glyphicon } from 'react-bootstrap';
import { DateRange } from 'react-date-range';


class CommunicationInfo extends React.Component {

    constructor() {
        super();
        this.state = {
            showMessage: true
        }
    }

    componentWillReceiveProps(props) {
        const msg = findDOMNode(this.refs.msg);
        clearInterval(this._blinker);
        if (props.info.waitingForData) {
            this._blinker = setInterval(() => {
                this.setState({ showMessage: !this.state.showMessage });
            }, 500);
        } else {
            this.setState({ showMessage: true })
        }
    }

    render() {
        let msg, color = "#999";
        if (this.props.info.error) {
            msg = "Error getting data!";
            color = "#F00";
        } else if (this.props.info.waitingForData) {
            msg = "Waiting for data...";
        } else if (this.props.info.receiveTime) {
            const elapsed = (this.props.info.receiveTime.getTime() -
                this.props.info.fetchTime.getTime()) / 1000;
            msg = `Done in ${elapsed} s.`;
        }
        return (
            <div ref="msg" style={{
                color: color,
                position: "absolute", right: 0, bottom: 0,
                display: this.state.showMessage ? "block" : "none"
            }}>
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

