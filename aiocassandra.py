"""
This code originally from https://github.com/wikibusiness/aiocassandra
"Simple threaded cassandra wrapper for asyncio"

License:
----
The MIT License

Copyright (c) WikiBusiness Corporation. http://wikibusiness.org/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
----

Modifications by johan.forsberg@gmail.com.
"""

# -*- coding: utf-8 -*-
from __future__ import unicode_literals

# -*- coding: utf-8 -*-
from __future__ import unicode_literals

import sys
from functools import partial

from cassandra.cluster import Session
from pandas import DataFrame, concat

from types import MethodType  # isort:skip

try:
    import asyncio
except ImportError:
    import trollius as asyncio

__version__ = '1.0.4'


def _asyncio_fut_factory(loop):
    try:
        return loop.create_future
    except AttributeError:
        return partial(asyncio.Future, loop=loop)


def _asyncio_result(self, cfut, afut, acc, result):
    acc.append(DataFrame(result))
    # here we need to take into account that large data is likely to be
    # split into "pages" (of 5000 rows each by default)
    if cfut.has_more_pages:
        cfut.start_fetching_next_page()
    else:
        # TODO: pandas.concat will create a new dataframe and copy all
        # the parts, which means that we'll use twice the memory for this
        # step. It would be nice to avoid that.
        self._loop.call_soon_threadsafe(afut.set_result,
                                        concat(acc, ignore_index=True))


def _asyncio_exception(self, cfut, afut, exc):
    self._loop.call_soon_threadsafe(afut.set_exception, exc)


def execute_future(self, *args, **kwargs):
    cassandra_fut = self.execute_async(*args, **kwargs)
    asyncio_fut = self._asyncio_fut_factory()
    acc_result = []  # a temporary place to store the results
    cassandra_fut.add_callbacks(
        partial(self._asyncio_result, cassandra_fut, asyncio_fut, acc_result),
        partial(self._asyncio_exception, cassandra_fut, asyncio_fut))
    return asyncio_fut


def aiosession(session, loop=None):
    assert isinstance(session, Session), 'provide cassandra.cluster.Session'

    if hasattr(session, '_asyncio_fut_factory'):
        raise RuntimeError('session is already patched by aiosession')

    if loop is None:
        loop = asyncio.get_event_loop()

    setattr(session, '_loop', loop)
    setattr(session, '_asyncio_fut_factory', _asyncio_fut_factory(loop=loop))
    setattr(session, '_last_result', [])

    if sys.version_info >= (3, 0):
        session._asyncio_result = MethodType(_asyncio_result, session)
        session._asyncio_exception = MethodType(_asyncio_exception, session)
        session.execute_future = MethodType(execute_future, session)
    else:
        session._asyncio_result = MethodType(_asyncio_result, session, Session)
        session._asyncio_exception = MethodType(_asyncio_exception, session, Session)  # noqa
        session.execute_future = MethodType(execute_future, session, Session)

    return session
