import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";
import { createStore, applyMiddleware, combineReducers } from 'redux';
import thunkMiddleware from 'redux-thunk'
import createLogger from 'redux-logger';
// import { browserHistory, Router, Route, Link } from 'react-router'
import { Nav, Navbar, NavItem, NavDropdown, MenuItem, Grid, Col, Row } from 'react-bootstrap';

import * as reducers from "./reducers";
import {
  getControlsystems, setControlsystem,
  addAttributes, setTimeRange, setAxisScale
} from "./actions";
import PlotWrapper from "./plotwrapper";
// import TimeRange from "./timerange";
import AttributeSearch from "./attributes";
import CommunicationInfo from "./communication";
import { debounce, loadStateFromHash, setHashFromState } from "./utils";
import { Container } from "react-bootstrap/lib/Tab";

/* redux store */

const logger = createLogger();
const createStoreWithMiddleware = applyMiddleware(
  thunkMiddleware // lets us dispatch() functions
  , logger // logs all actions to console for debugging
)(createStore)

const reducer = combineReducers(reducers);
let store = createStoreWithMiddleware(reducer);


store.dispatch(getControlsystems())


class App extends React.Component {

  render() {
    return (<div>
      <Grid fluid={true}>
        <Row>
          <Navbar fluid={true}>
            <Navbar.Header style={{ width: "40%" }}>
              <Navbar.Brand>
                <a href="https://maxiv.lu.se">
                  <img
                    src="images/maxiv.png"
                    className="d-inline-block align-top max-logo"
                    alt="React Bootstrap logo"
                  />
                </a>
              </Navbar.Brand>
            </Navbar.Header>

            <Nav className="mr-auto">
              <NavItem className="navitem" eventKey={2} href="/index.html">
                <div className="header-app-name">
                  HDB++<span className="header-app-name-secondary">Archive Viewer</span>
                </div>
              </NavItem>
            </Nav>

            <Navbar.Form pullRight>
              <Nav>
                <NavItem eventKey={2} href="/help.html">Help</NavItem>
              </Nav>
            </Navbar.Form>
          </Navbar>
        </Row>

        <Row>
          {/* <TimeRange /> */}
          <Col sm={3} md={3}>
            <AttributeSearch />
          </Col>
          <Col sm={9} md={9} xs={9}>
            <PlotWrapper />
          </Col>
        </Row>
      </Grid>
      <CommunicationInfo />
    </div>
    );
  }
}


render((<Provider store={store}>
  <App />
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
  store.dispatch(setControlsystem(hashData.controlsystem));
  if (hashData.timeRange) {
    store.dispatch(setTimeRange(new Date(hashData.timeRange.start),
      new Date(hashData.timeRange.end)))
  } else {
    // default to the last hour
    const now = new Date(),
      anHourAgo = new Date();
    anHourAgo.setTime(now.getTime() - 3600000);
    store.dispatch(setTimeRange(anHourAgo, now));
  }
  const axes = {};
  (hashData.attributes || []).forEach(
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
  axisNames.forEach(axis => {
    let attrs = axes[axis];
    store.dispatch(addAttributes(attrs, parseInt(axis)))
    const axisConfig = hashData.axes[axis] || {};
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


