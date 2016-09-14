import time


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
