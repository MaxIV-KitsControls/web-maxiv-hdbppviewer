import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";
import { createStore, applyMiddleware, combineReducers } from 'redux';
import thunkMiddleware from 'redux-thunk'
import createLogger from 'redux-logger';
// import { browserHistory, Router, Route, Link } from 'react-router'
import { Nav, Navbar, NavItem, NavDropdown, MenuItem, Grid, Col, Row } from 'react-bootstrap';

import * as reducers from "./reducers";
import {addAttributes, setTimeRange, setAxisScale } from "./actions";
import PlotWrapper from "./plotwrapper";
import TimeRange from "./timerange";
import AttributeSearch from "./attributes";
import CommunicationInfo from "./communication";
import {debounce, loadStateFromHash, setHashFromState} from "./utils";

/* redux store */

const logger = createLogger();
const createStoreWithMiddleware = applyMiddleware(
    thunkMiddleware // lets us dispatch() functions
    , logger // logs all actions to console for debugging
)(createStore)

const reducer = combineReducers(reducers);
let store = createStoreWithMiddleware(reducer);


class App extends React.Component {

    render () {
        return (<div>
                  <Grid fluid={true}>
                    <Row>
                      <Navbar>
                        <Navbar.Header>
                          <Navbar.Brand>
                            <a href="/index.html">HDB++ Archive Viewer</a>
                          </Navbar.Brand>
                        </Navbar.Header>
                        <Nav>
                          <NavDropdown eventKey={1} title="Database" id="basic-nav-dropdown">
                          <MenuItem eventKey={3.1}>g-v-csdb-0</MenuItem>
                          <MenuItem eventKey={3.2}>b-femtomax-csdb-0</MenuItem>
                          <MenuItem eventKey={3.3}>b-veritas-csdb-0</MenuItem>
                          <MenuItem eventKey={3.4}>...</MenuItem>
                          <MenuItem divider/>
                          <MenuItem eventKey={3.3}>All</MenuItem>
                          </NavDropdown>
                          <NavItem eventKey={2} href="#">Help</NavItem>
                        </Nav>

                        <Navbar.Form pullRight>
                          <TimeRange/>
                        </Navbar.Form>
                      </Navbar>            
                    </Row>
                
                    <Row>
                      <Col sm={3} md={3}>
                        <AttributeSearch/>
                      </Col>
                      <Col sm={9} md={9} xs={9}>
                        <PlotWrapper/>
                      </Col>
                    </Row>
                  </Grid>
                <CommunicationInfo/>
                </div>
         );
    }
}


render((<Provider store={store}>
          <App/>
        </Provider>),
       document.getElementById("main"));


/* Update page title */

store.subscribe(debounce(() => {
    const state = store.getState();
    const attributes = state.attributes;
    const startDate = state.timeRange.start.toLocaleDateString(),
          endDate = state.timeRange.end.toLocaleDateString();

    if (startDate == endDate) {
        document.title = `Archive viewer: ${attributes.map(attr => attr.split(":")[0]).join(",")} ${startDate}`;
    } else {
        document.title = `Archive viewer: ${attributes.map(attr => attr.split(":")[0]).join(",")} ${startDate} - ${endDate}`;        
    }
}), 100);


/* setup browser URL handling */

function dispatchFromHash() {
    // a very hacky way to load state from JSON 
    if (document.location.hash == currentHash)
        return
    else
        currentHash = document.location.hash
    const hashData = loadStateFromHash()
    store.dispatch(setTimeRange(new Date(hashData.timeRange.start),
                                new Date(hashData.timeRange.end)))
    const axes = {};
    hashData.attributes.forEach(
        attr => {
            const config = hashData.config[attr],
                  axis = config.axis || 0;
            console.log(attr, config, axis)
            if (config.axis in axes)
                axes[axis].push([attr, config.color]);
            else
                axes[axis] = [[attr, config.color]];
        }
    )
    let axisNames = Object.keys(axes)
    axisNames.sort()
    console.log("axes", axes);
    axisNames.forEach(axis => {
        let attrs = axes[axis];
        store.dispatch(addAttributes(attrs, parseInt(axis)))
        const axisConfig = hashData.axes[axis];
        store.dispatch(setAxisScale(parseInt(axis),
                                    axisConfig.scale || "linear"))
    });
}

if (document.location.hash.length > 1) {
    dispatchFromHash();
}

let currentHash;
window.addEventListener("hashchange", function () {
    dispatchFromHash();
})

store.subscribe(debounce(function () {
    setHashFromState(store.getState());
    currentHash = document.location.hash;
}, 100));


