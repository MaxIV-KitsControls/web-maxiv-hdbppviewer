/*
A "reducer" is a function that takes a (partial) redux state and an
action, and returns a new state with the updates corresponding to the
action.

The global state is never changed in-place, it is just replaced with
a new state, via reducers, whenever an action is dispatched.
*/

import R from "ramda";

import {
    RECEIVE_SUGGESTIONS,
    RECEIVE_CONTROLSYSTEMS, SET_CONTROLSYSTEM,
    FETCH_ARCHIVE_DATA, RECEIVE_ARCHIVE_DATA, RECEIVE_DETAILS,
    RECEIVE_ARCHIVE_DESCS, FETCH_FAILED,
    ADD_ATTRIBUTES, REMOVE_ATTRIBUTES, SET_ATTRIBUTES_AXIS,
    SET_ATTRIBUTE_COLOR, SET_ATTRIBUTE_WIDTH,
    SET_TIME_RANGE,
    SET_Y_RANGE,
    SET_AXIS_SCALE,
    SET_AUTO_SCALE
} from "./actions";


export function controlsystems(state=[], action) {
    switch (action.type) {
        case RECEIVE_CONTROLSYSTEMS:
            return action.controlsystems;
    }
    return state;
}


export function controlsystem(state=null, action) {
    switch (action.type) {
        case SET_CONTROLSYSTEM:
            return action.controlsystem;
    }
    return state;
}


export function attributeSuggestions(state=[], action) {
    switch (action.type) {
    case RECEIVE_SUGGESTIONS:
        return action.suggestions;
    }
    return state;
}

export function archiveData(state={}, action) {
    switch (action.type) {
    case RECEIVE_ARCHIVE_DATA:
        return action.data;
    case REMOVE_ATTRIBUTES:
        return R.omit(action.attributes, state);
    default:
        return state;
    }
}


export function details(state={}, action) {
    switch (action.type) {
    case RECEIVE_DETAILS:
        return {...action.details};
    default:
        return state;
    }
}


export function attributes(state=[], action) {
    switch (action.type) {
    case ADD_ATTRIBUTES:
        return R.union(action.attributes, state);
    case REMOVE_ATTRIBUTES:
        return R.without(action.attributes, state);
    default:
        return state;
    }
}


export function descriptions(state=[], action) {
    switch (action.type) {
    case RECEIVE_ARCHIVE_DESCS:
        return {...action.descs};
    }
    return state;
}


// brewer color scale "Set1"
const LINE_COLORS = ["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#ffff33","#a65628","#f781bf","#999999"];


export function attributeConfig(state={}, action) {
    let updates = {};
    switch (action.type) {
    case SET_ATTRIBUTE_COLOR:
        let color;
        if (action.color) {
            color = action.color;
        } else {
            // if there are unused colors, we pick the first one of those
            const usedColors = new Set(Object.keys(state).map(k => state[k].color)),
                  remainingColors = LINE_COLORS.filter(c => !usedColors.has(c));
            if (remainingColors.length > 0) {
                color = remainingColors[0];
            } else {
                // all colors are taken, we'll just simply check which colors are used
                // the least and pick the first one of those.
                let colorUsage = {};
                Object.keys(state).forEach(k => {
                    const line = state[k];
                    if (line.attribute == action.attribute) {return;}
                    colorUsage[line.color] = colorUsage[line.color] && colorUsage[line.color] + 1 || 1;
                });
                var leastUsed;
                Object.keys(colorUsage).forEach(k =>  {
                    if (leastUsed === undefined || colorUsage[k] < colorUsage[leastUsed]) {
                        leastUsed = k;
                    }
                });
                color = leastUsed;
            }
        }
        updates[action.attribute] = {...state[action.attribute], color};
        return {...state, ...updates};
    case SET_ATTRIBUTE_WIDTH:
        updates[action.attribute] = {...state[action.attribute], width: action.width}
        return {...state, ...updates}
    case SET_ATTRIBUTES_AXIS:
        action.attributes.forEach(
            attr => {
                if (attr in state)
                    updates[attr] = {...state[attr], axis: action.axis};
                else
                    updates[attr] = {axis: action.axis};
            }
        );
        return {...state, ...updates};
    case REMOVE_ATTRIBUTES:
        return R.omit(action.attributes, state);
    default:
        return state;
    }
}


export function axisConfiguration(state={}, action) {
    switch (action.type) {
    case SET_AXIS_SCALE:
        let config = state[action.axis] || {};
        let newConfig = R.assoc("scale", action.scale, config);
        return R.assoc(action.axis, newConfig, state);
    case SET_Y_RANGE:
        let type = action.id;
        switch (action.id) {
            case 'y1Min':
                return {...state, 0: {...state[0], min: action.value}};
            case 'y1Max':
                return {...state, 0: {...state[0], max: action.value}};
            case 'y2Min':
                return {...state, 1: {...state[1], min: action.value}};
            case 'y2Max':
                return {...state, 1: {...state[1], max: action.value}};
            default:
                break;
        }
    case SET_AUTO_SCALE:
          return {0: {scale: 'linear'}, 1: {scale: 'linear'}};
    }
    return state;
}


export function communicationInfo(state={}, action) {
    switch (action.type) {
    case FETCH_ARCHIVE_DATA:
        return { error: null,
                 waitingForData: true,
                 fetchTime: new Date()};
    case RECEIVE_ARCHIVE_DATA:
        return {...state,
                error: null,
                waitingForData: false,
                receiveTime: new Date()};
    case FETCH_FAILED:
        return {...state,
                error: action.error,
                waitingForData: false,
                receiveTime: new Date()};
    }

    return state;
}

const defaultTimeRange = {start: new Date(Date.now() - 3600e3),
                          end: new Date(Date.now())};

export function timeRange(state=defaultTimeRange, action) {
    switch (action.type) {
    case SET_TIME_RANGE:
        return {start: action.startTime, end: action.endTime};
    default:
        return state;
    }
}

export function actionBar (state=archiveData, action) {
    switch (action.type) {
    case RECEIVE_ARCHIVE_DATA:
        return {
            y1Min: action.data[0] ? action.data[0].y_range[0].toExponential(1) : '-1e+0',
            y1Max: action.data[0] ? action.data[0].y_range[1].toExponential(1) : '1e+0',
            y2Min: action.data[1] ? action.data[1].y_range[0].toExponential(1) : '-1e+0',
            y2Max: action.data[1] ? action.data[1].y_range[1].toExponential(1) : '1e+0'
        };
    default:
        return state;
    }
}
