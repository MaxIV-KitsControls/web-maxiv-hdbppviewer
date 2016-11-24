import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { bindActionCreators } from 'redux'
// import AutoSuggest from 'react-autosuggest';
import fetch from "isomorphic-fetch";
import { Input, Button, DropdownButton, MenuItem, Col, Panel, Popover,
         OverlayTrigger, FormGroup, FormControl, Modal, Accordion, Table, Well,
         Checkbox } from 'react-bootstrap';

import { getControlsystems, getSuggestions,
         addAttributes, removeAttributes,
         setAxisScale } from "./actions";


const ATTRIBUTE_REGEX = /(.*)\/([^/]+\/[^/]*\/[^/]*\/[^/]*)/;


class PlottedAttributes extends React.Component {

    constructor() {
        super();
        this.state = {
            selected: []
        }
    }

    getAttributesOnYAxis(axis) {
        return this.props.attributes
            //.map(k => this.props.config[k])
            .filter(a => this.props.config[a].axis == axis);
    }

    onAttributeClick(attribute) {
        let selected;
        if (this.state.selected.indexOf(attribute) == -1) {
            selected = [...this.state.selected, attribute]
        } else  {
            selected = [...this.state.selected]
            selected.splice(selected.indexOf(attribute), 1)
        }
        this.setState({selected});
    }

    onYAxisClick(axis) {
        const attributes = this.getAttributesOnYAxis(axis);
    }
    
    onRemove() {
        this.props.removeAttributes(this.state.selected)
    }

    makeAttributePopover (attr, cs, name) {
        const config = this.props.config[attr] || {}
        const desc = this.props.desc[attr] || {};
        return (<Popover className="attribute-info" id={`attribute-${name}`}>
                  <table>
                    <tbody>
                      <tr>
                        <th>Name:</th><td colSpan="5">{name}</td>
                      </tr>
                        <tr>
                          <th>CS:</th> <td colSpan="5">{cs}</td>
                        </tr>
                        <tr>
                          <th>Axis:</th> <td>{config.axis}</td>
                          <th>Color:</th> <td>{config.color}</td>
                          <th>Points:</th> <td>{desc.total_points}</td>
                        </tr>
                      </tbody>
                    </table>
                </Popover>)
    }

    onAxisScaleChange(axis, event) {
        const isLog = event.target.checked;
        console.log("axisScale change", axis, isLog)
        this.props.setAxisScale(axis, isLog? "log" : "linear");
    }
    
    
    // makeAxisPopover (axis) {
    //     const config = this.props.axes[axis];
    //     return (<Popover id={`attribute-${attr}`} title={axis}>
    //               <div>Scale: {config.scale || "linear"}</div>
    //             </Popover>);
    // }
    
    makeAttribute(a) {
        console.log("makeAttribute", a)
        const [cs, name] = ATTRIBUTE_REGEX.exec(a).slice(1);
        return (<li key={a} onClick={this.onAttributeClick.bind(this, a)}
                style={{
                    background: this.state.selected.indexOf(a) != -1? "lightgrey" : null
                }}>
                  <OverlayTrigger trigger={["hover", "focus"]} placement="right"
                                  overlay={this.makeAttributePopover(a, cs, name)}>
                    <div>
                      <span style={{color: this.props.config[a].color}}>■</span>
                        &nbsp;                         
                      <span>{name}</span>
                    </div>
                  </OverlayTrigger>
                </li>)
    }
    
    render () {
        const leftYAxis = this.getAttributesOnYAxis(0)
                  .map(a => this.makeAttribute(a)),
              rightYAxis = this.getAttributesOnYAxis(1)
                  .map(a => this.makeAttribute(a))

        return (
            <FormGroup>

              <Panel footer={
                <Button bsStyle="danger" onClick={this.onRemove.bind(this)}
                        disabled={this.state.selected.length == 0}
                        title="Remove the currently selected attribute(s) from the plot">
                  Remove
                </Button>
              }>
                
                <div>
                  <strong onClick={this.onYAxisClick.bind(this, 0)}>
                    Left Y axis
                  </strong>
                <Checkbox checked={this.props.axes[0] && this.props.axes[0].scale == "log"}
                          onChange={this.onAxisScaleChange.bind(this, 0)}
                          inline style={{"float": "right"}}>
                  Log
                </Checkbox>
                </div>
                <ul className="y-axis-attributes"
                    style={{listStyle: "none", paddingLeft: "10px"}}>
                    {leftYAxis}
                </ul>
                
                <div>
                  <strong onClick={this.onYAxisClick.bind(this, 1)}>
                    Right Y axis
                  </strong>
                
                  <Checkbox checked={this.props.axes[1] && this.props.axes[1].scale == "log"}
                            onChange={this.onAxisScaleChange.bind(this, 1)}
                            inline style={{"float": "right"}}>
                    Log
                  </Checkbox>
                </div>
                <ul className="y-axis-attributes"
                    style={{listStyle: "none", paddingLeft: "10px"}}>
                  {rightYAxis}
                </ul>
                
              </Panel>
                

            </FormGroup>
        );
    }
    
}

    
class Attributes extends React.Component {

    constructor(props) {
        super();
        // if the controlsystems list is already populated, default to
        // the first one
        const cs = props.controlsystems.length > 0? props.controlsystems[0] : null;
        this.state = {
            pattern: '',
            selectedSuggestions: [],
            selectedAttributes: [],
            controlsystem: cs,
            showSuggestions: false
        };
    }

    componentWillReceiveProps (props) {
        // if we receive a new list of control systems, again default
        // to the first one.
        if (props.controlsystems.length > 0 && !this.state.controlsystem) {
            this.setState({controlsystem: props.controlsystems[0]});
        }
    }

    // the user has typed something in the search field
    onPatternChange (event) {
        let pattern = event.target.value;
        const cs = this.state.controlsystem;
        this.props.getSuggestions(cs, pattern);
        this.setState({pattern});
    }

    // the user has changed the selection of search results
    onSelectSuggestions (event) {
        let selected = getSelectedOptions(event.target);
        this.setState({selectedSuggestions: selected});
    }

    // the user has marked/unmarked some of the plotted attributes
    onSelectAttributes (event) {
        let selected = getSelectedOptions(event.target);
        this.setState({selectedAttributes: selected});
    }

    // the user is adding attributes to the plot
    onAddAttributes (axis, event) {
        const cs = this.state.controlsystem;
        const attributes = this.state.selectedSuggestions.map(attr => `${cs}/${attr}`);
        this.props.addAttributes(attributes, axis);
    }

    // the user is removing attributes from the plot
    onRemoveAttributes (attributes) {
        this.props.removeAttributes(attributes);
    }
    
    onSelectControlsystem (event) {
        const controlsystem = event.target.value;
        this.setState({controlsystem, selectedAttributes: []});
        this.props.getSuggestions(controlsystem, this.state.pattern);        
    }
    
    renderAttributeInfo() {
        if (this.state.selectedAttributes.length > 0) {
            const attr = this.state.selectedAttributes[0];
            const config = this.props.config[attr]
            const desc = this.props.desc[attr]
            return (<Table condensed className="attribute-info">
                      <thead>
                        <tr>
                          <th>Name:</th> <th>{attr}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Axis:</td> <td>{config.axis}</td>
                        </tr>
                        <tr>
                          <td>Color:</td> <td>{config.color}</td>
                        </tr>
                        <tr>
                          <td>Points:</td> <td>{desc.total_points}</td>
                        </tr>
                      </tbody>
                    </Table>);
        }
    }
    
    render () {
        
        // the list of available control systems
        const controlsystemOptions = this.props.controlsystems.map(
            (cs, i) => <option key={i} value={cs}>{cs}</option>);
        

        // the list of attribute matches
        const suggestOptions = this.props.suggestions.map(sugg => {
            return <option key={sugg} value={sugg} title={sugg}
                         disabled={this.props.attributes.indexOf(`${this.state.controlsystem}/${sugg}`) != -1}>
                       {sugg}
                   </option>;
        });

        // the list of plotted attributes
        const plottedAttributes = <PlottedAttributes {...this.props}
                                      removeAttributes={this.onRemoveAttributes.bind(this)}/>

        const addButton = (
                <DropdownButton id="add-attribute" bsStyle="success" title="Add"
                     disabled={this.state.selectedSuggestions.length == 0}>
                  <MenuItem eventKey={0}
                            onSelect={this.onAddAttributes.bind(this)}>
                    Left Y
                  </MenuItem>
                  <MenuItem eventKey={1}
                            onSelect={this.onAddAttributes.bind(this)}>
                    Right Y
                  </MenuItem>
                </DropdownButton>);
      
        return (
                <div>
                  <form>               
                    <Panel footer={addButton}>
                      <FormGroup>
                        <FormControl componentClass="select" ref="cs"
                                     title="Pick your control system"
                                     value={this.state.controlsystem}
                                     onChange={this.onSelectControlsystem.bind(this)}> 
                          {controlsystemOptions}
                        </FormControl>
                      </FormGroup>
                      <FormGroup>                
                        <FormControl type="search" ref="search"
                                     title="Search for some attribute(s)"
                                     value={this.state.pattern}
                                     onChange={this.onPatternChange.bind(this)}
                                     placeholder="e.g */vac/*/pressure"/>
                        </FormGroup>
                        <FormControl componentClass="select" ref="attributes"
                                     title="Select the interesting ones from the matching list of attributes"
                                     multiple value={this.state.selectedSuggestions}
                                     style={{width: "100%"}} size="10"
                                     onChange={this.onSelectSuggestions.bind(this)}>
                          {suggestOptions}
                        </FormControl>
                    </Panel>
                    {plottedAttributes}
                  </form>            
                </div>
        );
    }
}
    

function mapStateToProps (state) {
    return {
        controlsystems: state.controlsystems,
        attributes: state.attributes,
        config: state.attributeConfig,
        desc: state.descriptions,
        suggestions: state.attributeSuggestions,
        axes: state.axisConfiguration
    }
}


function mapDispatchToProps(dispatch) {
    return {
        getControlsystems: () => dispatch(getControlsystems()),
        getSuggestions: (controlsystem, pattern) => dispatch(getSuggestions(controlsystem, pattern)),
        addAttributes: (attributes, axis) => dispatch(addAttributes(attributes, axis)),
        removeAttributes: attributes => dispatch(removeAttributes(attributes)),
        setAxisScale: (axis, scale) => dispatch(setAxisScale(axis, scale))
    }
}


export default connect(mapStateToProps, mapDispatchToProps)(Attributes);


// helper
function getSelectedOptions(select) {
    return [].filter.call(select.options, function (o) {
        return o.selected;
    }).map(function (o) {
        return o.value;
    });
}
