import React from 'react';
import { ChromePicker } from 'react-color';
import { Button } from 'react-bootstrap';

class ColorPicker extends React.Component {
  state = {
    displayColorPicker: false,
  };

  handleClick = () => {
    this.setState({ displayColorPicker: !this.state.displayColorPicker })
  };

  handleClose = () => {
    this.setState({ displayColorPicker: false })
  };

  render() {
    const popover = {
      position: 'absolute',
      zIndex: '2',
    }
    const cover = {
      position: 'fixed',
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px',
    }
    return (
      <div>
        <Button onClick={this.handleClick}>Pick Color</Button>
        { this.state.displayColorPicker ? <div style={popover}>
          <div style={cover} onClick={this.handleClose} />
          <ChromePicker
            color={this.props.color}
            onChangeComplete={this.props.onSelectColor}
          />
        </div> : null}
      </div>
    )
  }
}

export default ColorPicker
