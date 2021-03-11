import asyncio
from collections import OrderedDict
from contextlib import contextmanager

import logging
import time
from dateutil import tz
from dateutil.parser import parse as parse_time

# Parse a string into a time.
# The database uses UTC, and Pandas needs a 'naive' time without timezone.
# If we get a time without timezone, we assume it's UTC
# If the time is given with timezone, we translate to UTC and then drop the timezone. 
def parse_time_to_naive(timestring):
    parsed_time = parse_time(timestring)
    if not parsed_time.tzinfo:
        return parsed_time
    naive_time = parsed_time.astimezone(tz.UTC).replace(tzinfo=None)
    return naive_time


@contextmanager
def timer(msg):
    start = time.time()
    yield
    logging.debug("%s took %f s", msg, time.time() - start)


class memoized_ttl(object):
    """Decorator that caches a function's return value each time
    it is called within the time-to-live.
    Note: does not care about arguments!
    """

    def __init__(self, ttl):
        self.ttl = ttl

    def __call__(self, f):
        def wrapped_f(*args):
            now = time.time()
            try:
                value, last_update = self.cache
                if self.ttl > 0 and now - last_update > self.ttl:
                    raise AttributeError
                return value
            except AttributeError:
                value = f(*args)
                self.cache = (value, now)
                return value
        return wrapped_f


class retry_future:

    """This is a decorator that can be used to decorate functions that
    return a future. The decorated function returns another future that
    checks the result of the original future. If it's OK, the outer
    future just forwards the result. If there was an error, the inner
    function is re-run until either there is a result, or max_retries
    is reached, in chich case the the last exception is set on the
    outer future.

    TODO: somehow configure which exceptions to retry and which to just
    fail immediately. E.g. invalid requests and similar are pointless
    to retry, while timeouts and availability problems make sense.
    """

    def __init__(self, max_retries):
        self.max_retries = 5

    def __call__(self, f):
        def wrapped_f(*args, **kwargs):
            inner_fut = f(*args)
            outer_fut = asyncio.Future()
            retries = 0

            def resolve_or_retry(fut_):
                if not fut_.exception():
                    outer_fut.set_result(fut_.result())
                else:
                    nonlocal retries
                    retries += 1
                    logging.info("Retry %d of function %s(%r, %r): %s",
                                 retries, f, args, kwargs, fut_.exception())
                    if retries < self.max_retries:
                        fut = f(*args)  # new 'inner' future
                        fut.add_done_callback(resolve_or_retry)
                    else:
                        outer_fut.set_exception(fut_.exception())

            inner_fut.add_done_callback(resolve_or_retry)
            return outer_fut
        return wrapped_f


class LRUDict(OrderedDict):

    # http://code.activestate.com/recipes/580644-lru-dictionary/

    '''An dict that can discard least-recently-used items, either by maximum capacity
    or by time to live.
    An item's ttl is refreshed (aka the item is considered "used") by direct access
    via [] or get() only, not via iterating over the whole collection with items()
    for example.
    Expired entries only get purged after insertions or changes. Either call purge()
    manually or check an item's ttl with ttl() if that's unacceptable.
    '''

    def __init__(self, *args, maxduration=None, maxsize=128, **kwargs):
        '''Same arguments as OrderedDict with these 2 additions:
        maxduration: number of seconds entries are kept. 0 or None means no timelimit.
        maxsize: maximum number of entries being kept.'''
        super().__init__(*args, **kwargs)
        self.maxduration = maxduration
        self.maxsize = maxsize
        self.purge()

    def purge(self):
        """Removes expired or overflowing entries."""
        if self.maxsize:
            # pop until maximum capacity is reached
            overflowing = max(0, len(self) - self.maxsize)
            for _ in range(overflowing):
                self.popitem(last=False)
        if self.maxduration:
            # expiration limit
            limit = time.time() - self.maxduration
            # as long as there are still items in the dictionary
            while self:
                # look at the oldest (front)
                _, lru = next(iter(super().values()))
                # if it is within the timelimit, we're fine
                if lru > limit:
                    break
                # otherwise continue to pop the front
                self.popitem(last=False)

    def __getitem__(self, key):
        # retrieve item
        value = super().__getitem__(key)[0]
        # update lru time
        super().__setitem__(key, (value, time.time()))
        self.move_to_end(key)
        return value

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def ttl(self, key):
        '''Returns the number of seconds this item will live.
        The item might still be deleted if maxsize is reached.
        The time to live can be negative, as for expired items
        that have not been purged yet.'''
        if self.maxduration:
            lru = super().__getitem__(key)[1]
            return self.maxduration - (time.time() - lru)

    def __setitem__(self, key, value):
        super().__setitem__(key, (value, time.time()))
        self.purge()

    def items(self):
        # remove ttl from values
        return ((k, v) for k, (v, _) in super().items())

    def values(self):
        # remove ttl from values
        return (v for v, _ in super().values())


class SizeLimitedCache:

    """A LRU cache that always stays below the given total max size.
    Works basically like a dict, each value is associated with a
    unique, hashable key.

    Also requres a function to calculate the memory usage of a
    single item, in the same unit as 'max_size'.

    E.g. for a pandas dataframe it might be something like:

      get_item_size=lambda df: df.memory_usage(deep=True).sum()

    This means 'max_size' is in bytes.

    Note: possibly not a super fast cache, but almost guaranteed to be
    way faster than fetching from the database (or processing the
    data) so I bet optimizing it won't make any noticable difference :)
    """

    _cache = OrderedDict()
    _sizes = {}

    def __init__(self, max_size, get_item_size):
        self.max_size = max_size
        self.get_item_size = get_item_size

    @property
    def size(self):
        return sum(self._sizes.values())

    def __getitem__(self, name):
        return self.get(name)

    def get(self, name):
        if name in self._cache:
            value = self._cache.pop(name)
            self._cache[name] = value  # mark as "most recently used"
            return value
        raise KeyError

    def __setitem__(self, name, value):
        self.set(name, value)

    def set(self, name, value):
        size = self.get_item_size(value)
        if size >= self.max_size:
            # The value is larger than the maximum cache size,
            # no point in trying to store it.
            return
        # Make sure to remove any already existing data for the name
        self._cache.pop(name, None)
        self._sizes.pop(name, None)
        while self.size + size > self.max_size:
            # Evict the least recently used item until there's room for
            # the new one.
            # Note: This seems a little stupid; since sizes may differ a lot
            # we may end up making more space than actually needed.
            # OTOH, changing that means we're not a LRU cache anymore...
            rname, _ = self._cache.popitem(last=False)
            self._sizes.pop(rname)
        self._cache[name] = value
        self._sizes[name] = size
