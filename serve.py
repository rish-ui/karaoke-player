import functools
import http.server
import os

PORT = int(os.environ.get("PORT", 8123))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)
http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler).serve_forever()
