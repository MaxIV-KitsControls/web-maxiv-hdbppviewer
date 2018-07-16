import React from "react";
import {connect} from "react-redux";
import {setTimeRange, fetchArchiveData} from "./actions";
import { Input, Button, FormGroup, FormControl} from 'react-bootstrap';
import {setAxisScale} from "./actions";
import './actionbar.css';

class ActionBar extends React.Component {

      constructor (props) {
          super(props);
          this.state = {
              y1Min: '',
              y1Max: '',
              y2Min: '',
              y2Max: '',
          };
          this.handleInputChange = this.handleInputChange.bind(this);
          this.handleKeyPress = this.handleKeyPress.bind(this);
      }

      handleInputChange(event) {
        switch (event.target.id) {
          case 'y1Min':
            this.setState({y1Min: event.target.value});
            break;
          case 'y1Max':
            this.setState({y1Max: event.target.value});
            break;
          case 'y2Min':
            this.setState({y2Min: event.target.value});
            break;
          case 'y2Max':
            this.setState({y2Max: event.target.value});
            break;
          default:
            break;
        }
      }

      handleKeyPress(event) {
        switch (event.target.id) {
          case 'y1Min':
            if (event.keyCode == 13) {
                this.props.onChangeRangeElement('y1Min', event.target.value);
            }
            break;
          case 'y1Max':
            if (event.keyCode == 13) {
                this.props.onChangeRangeElement('y1Max', event.target.value);
            }
            break;
          case 'y2Min':
            if (event.keyCode == 13) {
                this.props.onChangeRangeElement('y2Min', event.target.value);
            }
            break;
          case 'y2Max':
            if (event.keyCode == 13) {
                this.props.onChangeRangeElement('y2Max', event.target.value);
            }
            break;
          default:
            break;
        }
      }



      render() {
          return (
              <div className="action-bar">
                <FormGroup>
                  <FormControl
                    type="text"
                    id="y1Min"
                    value={this.state.y1Min}
                    placeholder="Y1 Min"
                    onChange={this.handleInputChange}
                    onKeyDown={this.handleKeyPress}
                  />
                  <FormControl
                    type="text"
                    id="y1Max"
                    value={this.state.y1Max}
                    placeholder="Y1 Max"
                    onChange={this.handleInputChange}
                    onKeyDown={this.handleKeyPress}
                  />
                  <FormControl
                    type="text"
                    id="y2Min"
                    value={this.state.y2Min}
                    placeholder="Y2 Min"
                    onChange={this.handleInputChange}
                    onKeyDown={this.handleKeyPress}
                  />
                  <FormControl
                    type="text"
                    id="y2Max"
                    value={this.state.y2Max}
                    placeholder="Y2 Max"
                    onChange={this.handleInputChange}
                    onKeyDown={this.handleKeyPress}
                  />
                </FormGroup>
              </div>
          );
      }

      //callback from the plot
      onChange (start, end, width, height) {
          this.setState({timeRange: [start, end]})
          this.props.dispatch(setTimeRange(start, end));
          this.props.dispatch(fetchArchiveData(start, end, width, height));
      }

  }

  const mapStateToProps = (state) => {
      return {
          y1Min: state.y1Min,
          y1Max: state.y1Max,
          y2Min: state.y2Min,
          y2Max: state.y2Max,
      }
  }

  const mapDispatchToProps = (state) => {
      return {
          setAxisScale: (axis,scale) => dispatch(setAxisScale (axis,scale))
      }
  }


  export default connect(mapStateToProps)(ActionBar);
