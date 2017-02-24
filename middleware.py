"""
Middleware to serve index files (e.g. index.html) when static directories
are requested. https://github.com/crowsonkb/aiohttp_index.git
"""

"""
Copyright (c) 2016 Katherine Crowson

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
"""


__all__ = ['IndexMiddleware']


def IndexMiddleware(index='index.html'):
    """Middleware to serve index files (e.g. index.html) when static directories are requested.
    Usage:
    ::
        from aiohttp import web
        from aiohttp_index import IndexMiddleware
        app = web.Application(middlewares=[IndexMiddleware()])
        app.router.add_static('/', 'static')
    ``app`` will now serve ``static/index.html`` when ``/`` is requested.
    :param str index: The name of a directory's index file.
    :returns: The middleware factory.
    :rtype: function
    """
    async def middleware_factory(app, handler):
        """Middleware factory method.
        :type app: aiohttp.web.Application
        :type handler: function
        :returns: The retry handler.
        :rtype: function
        """
        async def index_handler(request):
            """Handler to serve index files (index.html) for static directories.
            :type request: aiohttp.web.Request
            :returns: The result of the next handler in the chain.
            :rtype: aiohttp.web.Response
            """
            try:
                filename = request.match_info['filename']
                if not filename:
                    filename = index
                if filename.endswith('/'):
                    filename += index
                request.match_info['filename'] = filename
            except KeyError:
                pass
            return await handler(request)
        return index_handler
    return middleware_factory
