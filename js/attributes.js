import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { bindActionCreators } from 'redux'
// import AutoSuggest from 'react-autosuggest';
import fetch from "isomorphic-fetch";
import { Input, Button, DropdownButton, MenuItem, Col, Panel, Popover,
         OverlayTrigger, FormGroup, FormControl, Modal, Accordion, Table, Well } from 'react-bootstrap';

import * as actionCreators from "./actions";
import {debounce} from "./utils"


class SearchResults extends React.Component {
}


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

    makeAttributePopover (attr) {
        const config = this.props.config[attr] || {}
        const desc = this.props.desc[attr] || {};
        return (<Popover id={`attribute-${attr}`} title={attr}>
                <div>Axis: {config.axis}</div>
                <div>Color: {config.color}</div>
                <div>Points: {desc.total_points}</div>
                </Popover>)
    }

    makeAttribute(a) {
        return (<li key={a} onClick={this.onAttributeClick.bind(this, a)}
                style={{
                    background: this.state.selected.indexOf(a) != -1? "lightgrey" : null
                }}>
                  <OverlayTrigger trigger={["hover", "focus"]} placement="right"
                                  overlay={this.makeAttributePopover(a)}>
                    <div>
                      <span style={{color: this.props.config[a].color}}>■</span>
                        &nbsp;                         
                      <span>{a}</span>
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
                  <strong onClick={this.onYAxisClick.bind(this, 0)}>
                    Left Y axis
                  </strong>
                <ul className="y-axis-attributes"
                    style={{listStyle: "none", paddingLeft: "10px"}}>
                    {leftYAxis}
                  </ul>
                  <strong onClick={this.onYAxisClick.bind(this, 1)}>
                    Right Y axis
                  </strong>
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

    constructor() {
        super();
        this.state = {
            pattern: '',
            suggestions: [],
            selectedSuggestions: [],
            selectedAttributes: [],
            showSuggestions: false
        };
    }

    // TODO: move this to an action!
    getSuggestions = debounce((pattern) => {
        fetch(`/attributes?search=${pattern}`)
            .then(response => response.json())
            .then(data => this.setState({suggestions: data.attributes}));
    }, 500)
    
    onPatternChange (event) {
        let pattern = event.target.value;
        this.getSuggestions(pattern);
        this.setState({pattern});
    }

    onSelectSuggestions (event) {
        let selected = getSelectedOptions(event.target);
        this.setState({selectedSuggestions: selected});
    }

    onSelectAttributes (event) {
        let selected = getSelectedOptions(event.target);
        this.setState({selectedAttributes: selected});
    }
    
    onAddAttributes (axis, event) {
        this.props.addAttributes(this.state.selectedSuggestions, axis);
    }

    onRemoveAttributes (attributes) {
        this.props.removeAttributes(attributes);
    }

    // return appropriate content for a select element that
    // shows the current attributes, grouped by Y axis
    getCurrentAttributeOptions () {        
        const axes = Array.from(new Set(
            Object.keys(this.props.config).map(k => this.props.config[k].axis))).sort();
        return axes.map(axis => (
                <optgroup label={axis === 0? "Left Y axis" : "Right Y axis"}>
                {this.props.attributes
                 .filter(a => this.props.config[a].axis == axis)
                 .map(attr => (
                       <option key={attr} value={attr} label={attr} title={attr}>
                         <span>     
                           <span style={{
                             fontWeight: "bold",
                             color: this.props.config[attr].color
                           }}> / </span> {attr}
                         </span>
                       </option>)
                     )}
                </optgroup>
        ));
        
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

        const attributeOptions = this.getCurrentAttributeOptions();
        const suggestOptions = this.state.suggestions.map(sugg => {
            return <option key={sugg} value={sugg} title={sugg}
                           disabled={this.props.attributes.indexOf(sugg) != -1}>
                       {sugg}
                   </option>;
        });
        const attributeFilter = (
                <FormControl type="search" ref="search"
                    value={this.state.pattern}
                    onChange={this.onPatternChange.bind(this)}
                    placeholder="e.g */vac/*/pressure"/>
        );
        const plottedAttributes = <PlottedAttributes {...this.props}
                                      removeAttributes={this.onRemoveAttributes.bind(this)}/>

        const buttons = (
                <DropdownButton bsStyle="success" title="Add"
                     disabled={this.state.selectedSuggestions.length == 0}>
                  <MenuItem eventKey={0}
                            onSelect={this.onAddAttributes.bind(this)}>
                    Left Y
                  </MenuItem>
                  <MenuItem eventKey={1}
                            onSelect={this.onAddAttributes.bind(this)}>
                    Right Y</MenuItem>
                  </DropdownButton>);
      
        return (
                <div>
                  <form>               
                    <Panel header={attributeFilter} footer={buttons}>
                        <FormControl componentClass="select" ref="attributes"  
                                     multiple value={this.state.selectedSuggestions}
                                     style={{width: "100%", height: "150"}}
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
        attributes: state.attributes,
        config: state.attributeConfig,
        desc: state.descriptions
    }
}


function mapDispatchToProps(dispatch) {
    return bindActionCreators(actionCreators, dispatch);
}


export default connect(mapStateToProps, mapDispatchToProps)(Attributes);



function getSelectedOptions(select) {
    return [].filter.call(select.options, function (o) {
        return o.selected;
    }).map(function (o) {
        return o.value;
    });
}
