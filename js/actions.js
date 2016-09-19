import fetch from "isomorphic-fetch";

import {debounce} from "./utils";


export const RECEIVE_SUGGESTIONS = "RECEIVE_SUGGESTIONS";
export const FETCH_ARCHIVE_DATA = "FETCH_ARCHIVE_DATA";
export const RECEIVE_ARCHIVE_DATA = "RECEIVE_ARCHIVE_DATA";
export const RECEIVE_ARCHIVE_DESCS = "RECEIVE_ARCHIVE_DESCS";
export const RECEIVE_DETAILS = "RECEIVE_DETAILS";
export const SET_TIME_RANGE = "SET_TIME_RANGE";
export const ADD_ATTRIBUTES = "ADD_ATTRIBUTE";
export const REMOVE_ATTRIBUTES = "REMOVE_ATTRIBUTE";
export const SET_ATTRIBUTES_AXIS = "SET_ATTRIBUTES_AXIS";
export const SET_ATTRIBUTE_COLOR = "SET_ATTRIBUTE_COLOR";
export const SET_AXIS_SCALE = "SET_AXIS_SCALE";


export function getSuggestions(pattern) {
    // ask the server for attributes matching the given pattern
    return debounce(function (dispatch) {
        fetch(`/attributes?search=${pattern}`)
            .then(response => response.json())
            .then(data => dispatch({type: RECEIVE_SUGGESTIONS, suggestions: data.attributes}));
    }, 500);  // no point in asking too often
}


export function addAttributes(attributes, axis) {
    // add a list of attributes to the given axis in the plot
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
        })
        dispatch({type: SET_ATTRIBUTES_AXIS, attributes: attrs, axis})
        dispatch({type: ADD_ATTRIBUTES, attributes: attrs});
    }
}


export function removeAttributes(attributes) {
    // remove a list of attributes from the plot
    return {type: REMOVE_ATTRIBUTES, attributes}
}


export function setTimeRange(startTime, endTime) {
    // change the current time range shown in the plot
    return {type: SET_TIME_RANGE, startTime, endTime}
}


export function setAxisScale(axis, scale) {
    return {type: SET_AXIS_SCALE, axis, scale};
}


var latestFetchTime = 0
export function fetchArchiveData(startTime, endTime, imageWidth, imageHeight) {
    // ask the server for data for the current view

    return function (dispatch, getState) {

        dispatch({type: FETCH_ARCHIVE_DATA})
        
        let state = getState();

        if (state.attributes.length == 0) {
            // no attributes configured; no point in requesting anything
            dispatch({type: RECEIVE_ARCHIVE_DESCS, descs: {}})
            dispatch({type: RECEIVE_ARCHIVE_DATA, data: {}})
            return;
        }
            
        let fetchTime = (new Date()).getTime();
        latestFetchTime = fetchTime;
        
        fetch("/image", {
            method: "POST",
            body: JSON.stringify({
                attributes: state.attributes.map(attr => {
                    return {
                        name: attr,
                        color: state.attributeConfig[attr].color,
                        y_axis: state.attributeConfig[attr].axis
                    }
                }),
                time_range: [state.timeRange.start.getTime(),
                             state.timeRange.end.getTime()],
                size: [imageWidth, imageHeight],
                axes: state.axisConfiguration
            }),
            headers: {
                "Content-Type": "application/json"
            }
        })
            .then(response => {
                if (latestFetchTime > fetchTime) {
                    // Trying to cancel because there's been a new request
                    response.body && response.body.cancel();
                    return;
                }
                return response.json();
            })
            .then(data => {
                if (latestFetchTime > fetchTime)
                    return;                                          
                dispatch({type: RECEIVE_ARCHIVE_DESCS, descs: data.descs});
                dispatch({type: RECEIVE_ARCHIVE_DATA, data: data.images});
            });
    }
}



