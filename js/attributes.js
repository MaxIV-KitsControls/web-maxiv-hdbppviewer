import React from "react";
import {connect} from "react-redux";
import { bindActionCreators } from 'redux'
// import AutoSuggest from 'react-autosuggest';
import fetch from "isomorphic-fetch";
import { Input, Button, DropdownButton, MenuItem, Col, Panel } from 'react-bootstrap';

import * as actionCreators from "./actions";
import {debounce} from "./utils"


class Attributes extends React.Component {

    constructor() {
        super();
        this.state = {
            pattern: '',
            suggestions: [],
            selectedSuggestions: [],
            selectedAttributes: []
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
    
    onAddAttributes (event, axis) {
        console.log("onAttAttributes")
        this.props.addAttributes(this.state.selectedSuggestions, axis);
        this.setState({selectedSuggestions: []})
    }

    onRemoveAttributes () {
        this.props.removeAttributes(this.state.selectedAttributes);
        this.setState({selectedAttributes: []})
    }

    // return appropriate content for a select element that
    // shows the current attributes, grouped by Y axis
    getCurrentAttributeOptions () {
        const axes = Array.from(new Set(
            Object.values(this.props.config).map(v => v.axis))).sort();
        return axes.map(axis => (
                <optgroup label={`Y axis ${axis}`}>
                {this.props.attributes
                 .filter(a => this.props.config[a].axis == axis)
                 .map(attr => (
                       <option key={attr} value={attr} label={attr}>
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
    
    render () {

        let suggestOptions = this.state.suggestions.map(sugg => {
            return <option key={sugg} value={sugg}>{sugg}</option>;
        })

        let attributeOptions = this.getCurrentAttributeOptions();
        
        return (
            <div>
                <Panel
                  style={{height: "40%"}}>
                <Input type="search"
                    value={this.state.pattern}
                    onChange={this.onPatternChange.bind(this)}
                    placeholder="e.g */vac/*/pressure"/>
                <Input type="select" value={this.state.selectedSuggestions}
                    ref="suggestions" multiple={true}
                    style={{width: "100%", height: "50%"}}
                    onChange={this.onSelectSuggestions.bind(this)}>
                  {suggestOptions}
                </Input>
                <DropdownButton title="Add"
                    disabled={this.state.selectedSuggestions.length == 0}>
                  <MenuItem eventKey={0}
                      onSelect={this.onAddAttributes.bind(this)}>Y1</MenuItem>
                  <MenuItem eventKey={1}
                      onSelect={this.onAddAttributes.bind(this)}>Y2</MenuItem>
                </DropdownButton>
              </Panel>
              <Panel
                  style={{height: "40%"}}>
                <Input type="select" ref="attributes" id="current-attributes"
                    multiple={true} value={this.state.selectedAttributes}
                    style={{width: "100%", height: "70%"}}
                    onChange={this.onSelectAttributes.bind(this)}>
                     {attributeOptions}
                  </Input>
                <Button onClick={this.onRemoveAttributes.bind(this)}
                    disabled={this.state.selectedAttributes.length == 0}>
                  Remove
                </Button>
              </Panel>
            </div>                
        );
    }
    
}
    

function mapStateToProps (state) {
    return {
        attributes: state.attributes,
        config: state.attributeConfig
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
