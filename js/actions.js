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
        dispatch(fetchArchiveData());
    }
}


export function removeAttributes(attributes) {
    // remove a list of attributes from the plot
    return {type: REMOVE_ATTRIBUTES, attributes}
}


export function setTimeRange(startTime, endTime) {
    // change the current time range shown in the plot
    return function (dispatch) {
        dispatch({type: SET_TIME_RANGE, startTime, endTime});
    }
}

var latestFetchTime = 0
export function fetchArchiveData(startTime, endTime, imageWidth, imageHeight) {
    return function (dispatch, getState) {
        let state = getState();
        const {start, end} = state.timeRange;
        const attrs = state.attributes.map(attr => {
            const color = encodeURIComponent(state.attributeConfig[attr].color),
                  axis = state.attributeConfig[attr].axis;
            return `${attr}:${axis}:${color}`;
        });
        let url = `/image?attributes=${attrs.join(",")}&time_range=${start.getTime()},${end.getTime()}&size=${imageWidth},${imageHeight}`
        let fetchTime = (new Date()).getTime();
        latestFetchTime = fetchTime;
        fetch(url)
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



