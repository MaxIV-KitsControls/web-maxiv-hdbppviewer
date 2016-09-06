
// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
export function debounce(func, wait, immediate) {
	var timeout;
	return function() {
		var context = this, args = arguments;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};


export function loadStateFromHash() {
    // TODO: verify that the hash data makes sense?
    return JSON.parse(decodeURIComponent(document.location.hash).slice(1));
}


export function setHashFromState(state) {

    let attributes = state.attributes.map(attr => {
        let config = state.attributeConfig[attr];
        console.log(attr, config);
        return `${attr}:${config.axis}`;
    })
    let hash = JSON.stringify({
        startTime: state.timeRange.start,
        endTime: state.timeRange.end,
        attributes: attributes
    })
    document.location.hash = hash;
}
