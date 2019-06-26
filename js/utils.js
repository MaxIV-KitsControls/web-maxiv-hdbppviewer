// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
export function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this,
            args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

export function loadStateFromHash() {
    // TODO: verify that the hash data makes sense?
    return JSON.parse(decodeURIComponent(document.location.hash).slice(1));
}

export function setHashFromState(state) {
    let hash = JSON.stringify({
        controlsystem: state.controlsystem,
        timeRange: state.timeRange,
        attributes: state.attributes,
        config: state.attributeConfig,
        axes: state.axisConfiguration
    });
    document.location.hash = hash;
}

const ATTRIBUTE_REGEX = /(.*)\/([^/]+\/[^/]*\/[^/]*\/[^/]*)/;

export function parseAttribute(attr) {
    return ATTRIBUTE_REGEX.exec(attr).slice(1);
}

export function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16)
          }
        : null;
}
