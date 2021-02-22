export function archiveDataStore(state = {}, action) {
    switch (action.type) {
        case RECEIVE_ARCHIVE_DATA:
            return { ...state, ...action.data };
        case RECEIVE_IMAGES:
            return { ...state, ...action.data };
        default:
            return state;
    }
}


