#!/usr/bin/env python3
"""Local preview of the app: serves the repo folder with caching off, so every reload shows the files as they are.

Usage: python3 tools/serve.py [port]   (default 8765, only on 127.0.0.1)
"""
import functools
import http.server
import pathlib
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
handler = functools.partial(NoCache, directory=str(root))
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
