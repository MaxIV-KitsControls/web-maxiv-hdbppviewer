from contextlib import contextmanager
import logging
import time


@contextmanager
def timer(msg):
    start = time.time()
    yield
    logging.debug("%s took %f s", msg, time.time() - start)
