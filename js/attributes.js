import React from "react";
import {findDOMNode} from "react-dom";
import {connect} from "react-redux";
import { bindActionCreators } from 'redux'
// import AutoSuggest from 'react-autosuggest';
import fetch from "isomorphic-fetch";
import { Input, Button, DropdownButton, MenuItem, Col, Panel,
         Overlay } from 'react-bootstrap';

import * as actionCreators from "./actions";
import {debounce} from "./utils"


class SearchResults extends React.Component {
}

    
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
        this.props.addAttributes(this.state.selectedSuggestions, axis);
        this.setState({selectedSuggestions: []})
    }

    onRemoveAttributes () {
        this.props.removeAttributes(this.state.selectedAttributes);
        this.setState({selectedAttributes: []})
    }

    makeSuggestions() {
        let suggestOptions = this.state.suggestions.map(sugg => {
            return <option key={sugg} value={sugg}
                           disabled={this.props.attributes.indexOf(sugg) != -1}>
                       {sugg}
                   </option>;
        })

        return (
                <div style={{
                        ...this.props.style,
                        position: 'absolute',
                        backgroundColor: '#EEE',
                        boxShadow: '0 5px 10px rgba(0, 0, 0, 0.2)',
                        border: '1px solid #CCC',
                        borderRadius: 3,
                        padding: 5}}>
                <Input type="select" value={this.props.selectedSuggestions}
                    ref="suggestions" multiple={true}
                    style={{width: "100%", height: "60%"}}
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
                <Button onClick={this.removeSuggestions.bind(this)}>Close</Button>
           </div>
        );
    }

    removeSuggestions () {
        this.setState({suggestions: []})
    }

    componentDidUpdate () {
        if (this.state.suggestions.length > 0) {
            const node = findDOMNode(this.refs.suggestions)
            console.log("hej", node);
            node.childNodes[0].focus()
        }
    }
    
    // return appropriate content for a select element that
    // shows the current attributes, grouped by Y axis
    getCurrentAttributeOptions () {        
        const axes = Array.from(new Set(
            Object.keys(this.props.config).map(k => this.props.config[k].axis))).sort();
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

    renderAttributeInfo() {
        if (this.state.selectedAttributes.length > 0) {
            const attr = this.state.selectedAttributes[0];
            const config = this.props.config[attr]
            const desc = this.props.desc[attr]
            return (<table className="attribute-info">
                    <tr>
                    <td>Name:</td> <td>{attr}</td>
                    </tr>
                    <tr>
                    <td>Axis:</td> <td>{config.axis}</td>
                    </tr>
                    <tr>
                    <td>Color:</td> <td>{config.color}</td>
                    </tr>
                    <tr>
                    <td>Points:</td> <td>{desc.total_points}</td>
                    </tr>
                    </table>);
        }
    }
    
    render () {

        let attributeOptions = this.getCurrentAttributeOptions();
        
        return (
            <div>
                <Input type="search" ref="search"
                    value={this.state.pattern}
                    onChange={this.onPatternChange.bind(this)}
                    placeholder="e.g */vac/*/pressure"/>
                <Overlay show={this.state.suggestions.length > 0}
                         placement="bottom" container={this} rootClose={true}
                         target={() => findDOMNode(this.refs.search)}>
                {this.makeSuggestions()}
                </Overlay>


                <Input type="select" ref="attributes" id="current-attributes"
                    multiple={true} value={this.state.selectedAttributes}
                    style={{width: "100%", height: "200"}}
                    onChange={this.onSelectAttributes.bind(this)}>
                     {attributeOptions}
                  </Input>

                {this.renderAttributeInfo()}
            
                <Button onClick={this.onRemoveAttributes.bind(this)}
                    disabled={this.state.selectedAttributes.length == 0}>
                  Remove
                </Button>
                
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
