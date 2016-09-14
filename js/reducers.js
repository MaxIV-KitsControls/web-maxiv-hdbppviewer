import R from "ramda";

import {
    RECEIVE_SUGGESTIONS,
    RECEIVE_ARCHIVE_DATA, RECEIVE_DETAILS,
    RECEIVE_ARCHIVE_DESCS,
    ADD_ATTRIBUTES, REMOVE_ATTRIBUTES, SET_ATTRIBUTES_AXIS,
    SET_ATTRIBUTE_COLOR,
    SET_TIME_RANGE
} from "./actions"


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
        return {...state, ...action.data};
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
        return {...state, ...action.descs};
    }
    return state;
}


const LINE_COLORS = ["red", "#5080FF", "#00FF00", "orange", "magenta", "cyan"]


export function attributeConfig(state={}, action) {
    let updates = {};
    switch (action.type) {
    case SET_ATTRIBUTE_COLOR:
        let color;
        if (action.color) {
            color = action.color;
        } else {
            const usedColors = new Set(Object.keys(state).map(k => state[k].color));
            const remainingColors = LINE_COLORS.filter(c => !usedColors.has(c));
            color = remainingColors[0]
            // TODO: handle case where there are more than 6 lines!
        }        
        updates[action.attribute] = {...state[action.attribute], color}
        return {...state, ...updates};
    case SET_ATTRIBUTES_AXIS:
        action.attributes.forEach(
            attr => {
                if (attr in state)
                    updates[attr] = {...state[attr], axis: action.axis}
                else
                    updates[attr] = {axis: action.axis};
            }
        )
        return {...state, ...updates};
    default:
        return state;
    }
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


