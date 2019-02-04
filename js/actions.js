/*

"Actions" are the only way to change the global state in a redux app.

An action is just an object that describes a change of state. It is
used as input to reducers. Normally, there is a convenience function
for creating an action.

There are also asynchronous actions, a.k.a "thunks". They are
functions that themselves use "dispatch" to cause other actions to
happen, depending on the outcome of e.g. network calls.

*/

import fetch from "isomorphic-fetch";

import {debounce} from "./utils";

var fileDownload = require('js-file-download');


// action types
export const RECEIVE_CONTROLSYSTEMS = "RECEIVE_CONTROLSYSTEMS";
export const SET_CONTROLSYSTEM = "SET_CONTROLSYSTEM";
export const RECEIVE_SUGGESTIONS = "RECEIVE_SUGGESTIONS";
export const FETCH_ARCHIVE_DATA = "FETCH_ARCHIVE_DATA";
export const FETCH_FAILED = "FETCH_FAILED";
export const RECEIVE_ARCHIVE_DATA = "RECEIVE_ARCHIVE_DATA";
export const RECEIVE_ARCHIVE_DESCS = "RECEIVE_ARCHIVE_DESCS";
export const RECEIVE_DETAILS = "RECEIVE_DETAILS";
export const SET_TIME_RANGE = "SET_TIME_RANGE";
export const SET_Y_RANGE = "SET_Y_RANGE";
export const ADD_ATTRIBUTES = "ADD_ATTRIBUTE";
export const REMOVE_ATTRIBUTES = "REMOVE_ATTRIBUTE";
export const SET_ATTRIBUTES_AXIS = "SET_ATTRIBUTES_AXIS";
export const SET_ATTRIBUTE_COLOR = "SET_ATTRIBUTE_COLOR";
export const SET_ATTRIBUTE_WIDTH = "SET_ATTRIBUTE_WIDTH";
export const SET_AXIS_SCALE = "SET_AXIS_SCALE";
export const SET_AUTO_SCALE = "SET_AUTO_SCALE";
export const FETCH_ARCHIVE_RAW_DATA = "FETCH_ARCHIVE_RAW_DATA";
export const FETCH_RAW_DATA_FAILED = "FETCH_RAW_DATA_FAILED";
export const RECEIVE_ARCHIVE_RAW_DATA = "RECEIVE_ARCHIVE_RAW_DATA";


export function getControlsystems() {
    // ask the server for attributes matching the given pattern
    return debounce(function (dispatch) {
        fetch('./controlsystems')
            .then(response => response.json())
            .then(data => dispatch({type: RECEIVE_CONTROLSYSTEMS,
                                    controlsystems: data.controlsystems}));
    }, 500);  // no point in asking too often
}


export function setControlsystem(controlsystem) {
    return {type: SET_CONTROLSYSTEM, controlsystem};
}


export function getSuggestions(controlsystem, pattern) {
    // ask the server for attributes matching the given pattern
    return debounce(function (dispatch, getState) {
        const state = getState();
        fetch(`./attributes?cs=${state.controlsystem}&search=${pattern}`)
            .then(response => response.json())
            .then(data => dispatch({type: RECEIVE_SUGGESTIONS,
                                    suggestions: data.attributes}));
    }, 500);  // no point in asking too often
}


export function addAttributes(attributes, axis) {
    // add a list of attributes to the given axis in the plot
    // the attributes must be on the form "{controlsystem}/{device}/{name}".
    return function (dispatch, getState) {
        let attrs = [];
        attributes.forEach(attr => {
            if (attr.constructor === Array) {
                const [name, color] = attr;
                attrs.push(name);
                dispatch({type: SET_ATTRIBUTE_COLOR, attribute: name, color});

            } else {
                attrs.push(attr);
                dispatch({type: SET_ATTRIBUTE_COLOR, attribute: attr});
            }
        });
        dispatch({type: SET_ATTRIBUTES_AXIS, attributes: attrs, axis});
        dispatch({type: ADD_ATTRIBUTES, attributes: attrs});
    };
}


export function removeAttributes(attributes) {
    // remove a list of attributes from the plot
    return {type: REMOVE_ATTRIBUTES, attributes};
}


export function setTimeRange(startTime, endTime) {
    // change the current time range shown in the plot
    return {type: SET_TIME_RANGE, startTime, endTime};
}

export function setYRange(id, value) {
    // set the y range in plot
    return {type: SET_Y_RANGE, id, value};
}

export function setAutoScale() {
    // set the y range to auto-scale (the default we get) in plot
    return {type: SET_AUTO_SCALE};
}


export function setAxisScale(axis, scale) {
    return {type: SET_AXIS_SCALE, axis, scale};
}


export function setAttributeColor(attribute, color) {
    return {type: SET_ATTRIBUTE_COLOR, attribute, color};
}

export function setAttributeWidth(attribute, width) {
    return {type: SET_ATTRIBUTE_WIDTH, attribute, width};
}

var latestFetchTime = 0;
export function fetchArchiveData(startTime, endTime, imageWidth, imageHeight) {
    // ask the server for data for the current view

    return function (dispatch, getState) {

        dispatch({type: FETCH_ARCHIVE_DATA});

        let state = getState();

        if (state.attributes.length == 0) {
            // no attributes configured; no point in requesting anything
            dispatch({type: RECEIVE_ARCHIVE_DESCS, descs: {}});
            dispatch({type: RECEIVE_ARCHIVE_DATA, data: {}});
            return;
        }

        let fetchTime = (new Date()).getTime();
        latestFetchTime = fetchTime;

        let p = fetch("./image", {
            method: "POST",
            body: JSON.stringify({
                attributes: state.attributes.map(attr => {
                    return {
                        name: attr,
                        y_axis: state.attributeConfig[attr].axis
                    };
                }),
                time_range: [state.timeRange.start.toUTCString(),
                             state.timeRange.end.toUTCString()],
                size: [imageWidth, imageHeight],
                axes: state.axisConfiguration,
            }),
            headers: {
                "Content-Type": "application/json"
            }
        });

        p.then(response => {
            if (response.status >= 400) {
                console.log(response);
                dispatch({
                    type: "FETCH_FAILED",
                    error: response.status
                });
                throw new Error("Did not receive archive data!");
            } else if (latestFetchTime > fetchTime) {
                // Trying to cancel because there's been a new request.
                // neither fetch nor js Promises support this ATM, but
                // maybe there will be a nice way at some point...
            } else {
                return response.json();
            }
        }, error => {
            console.log(error);
            dispatch({type: "FETCH_FAILED", error: 500});
            throw new Error("Could not fetch archive data!");
        }).then(data => {
            if (latestFetchTime > fetchTime) {
                console.log("discarding data because of staleness")
                return;
            }
            dispatch({type: RECEIVE_ARCHIVE_DESCS, descs: data.descs});
            dispatch({type: RECEIVE_ARCHIVE_DATA, data: data});
        });
    };
}

export function fetchArchiveDataRaw(type) {
    // ask the server for data for the current view
    let headers = { "Accept": "text/csv" }
    let filename = "data.csv";
    if (type == "JSON") {
        headers = { "Accept": "application/json" };
        filename = "data.json";
    }

    return function (dispatch, getState) {

        dispatch({type: FETCH_ARCHIVE_RAW_DATA});

        let state = getState();

        if (state.attributes.length == 0) {
            // no attributes configured; no point in requesting anything
            dispatch({type: RECEIVE_ARCHIVE_RAW_DATA});
            return;
        }

        let fetchTime = (new Date()).getTime();
        latestFetchTime = fetchTime;

        let p = fetch("./httpquery", {
            method: "POST",
            body: JSON.stringify({
                attributes: state.attributes,
                time_range: [state.timeRange.start.toUTCString(),
                             state.timeRange.end.toUTCString()],
            }),
            headers: headers
        });

        p.then(response => {
            if (response.status >= 400) {
                dispatch({
                    type: "FETCH_RAW_DATA_FAILED",
                    error: response.status
                });
                throw new Error("Did not receive archive raw data!");
            } else if (latestFetchTime > fetchTime) {
                // Trying to cancel because there's been a new request.
                // neither fetch nor js Promises support this ATM, but
                // maybe there will be a nice way at some point...
            } else {
                return response.text();
            }
        }, error => {
            console.log(error);
            dispatch({type: "FETCH_RAW_DATA_FAILED", error: 500});
            throw new Error("Could not fetch archive csv data!");
        }).then(data => {
            if (latestFetchTime > fetchTime)
                return;
            dispatch({type: RECEIVE_ARCHIVE_RAW_DATA});
            fileDownload(data, filename);
        });
    };
}
