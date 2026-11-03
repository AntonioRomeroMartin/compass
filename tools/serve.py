#!/usr/bin/env python3
"""Local preview of the app: serves the repo folder with caching off, so every reload shows the files as they are.

Usage: python3 tools/serve.py [port] [--demo DIR]   (default 8765, only on 127.0.0.1)

--demo DIR also answers a stand-in for GitHub's "contents" API at /demo-api/, reading and writing the JSON files
of DIR (make them with `node tools/demo.mjs DIR`). The app uses it when its settings carry "api": "/demo-api"
(set by opening /?demo on this server), so a preview never touches a real data repo. Use another port than the
real preview's: each port keeps its own settings in the browser.
"""
import base64
import functools
import hashlib
import http.server
import json
import pathlib
import sys
import urllib.parse

args = [a for a in sys.argv[1:]]
demo = None
if "--demo" in args:
    i = args.index("--demo")
    demo = pathlib.Path(args[i + 1]).resolve()
    del args[i:i + 2]

PREFIX = "/demo-api/repos/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def demo_file(self):
        """The file of the demo folder a contents URL names (/demo-api/repos/OWNER/REPO/contents/PATH)."""
        path = urllib.parse.urlparse(self.path).path
        if not demo or not path.startswith(PREFIX):
            return None
        parts = path[len(PREFIX):].split("/", 3)
        if len(parts) < 4 or parts[2] != "contents":
            return None
        f = (demo / urllib.parse.unquote(parts[3])).resolve()
        return f if demo in f.parents else None

    def answer(self, status, body=None, headers=()):
        data = json.dumps(body).encode() if body is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        f = self.demo_file()
        if f is None:
            return super().do_GET()
        if not f.is_file():
            return self.answer(404, {"message": "Not Found"})
        raw = f.read_bytes()
        sha = hashlib.sha1(raw).hexdigest()
        if self.headers.get("If-None-Match") == f'"{sha}"':
            return self.answer(304)
        self.answer(200, {"content": base64.b64encode(raw).decode(), "sha": sha}, [("ETag", f'"{sha}"')])

    def do_PUT(self):
        f = self.demo_file()
        if f is None:
            return self.answer(404, {"message": "Not Found"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        current = hashlib.sha1(f.read_bytes()).hexdigest() if f.is_file() else None
        if body.get("sha") != current:
            return self.answer(409, {"message": "sha does not match"})
        raw = base64.b64decode(body["content"])
        f.write_bytes(raw)
        self.answer(200, {"content": {"sha": hashlib.sha1(raw).hexdigest()}})


root = pathlib.Path(__file__).resolve().parent.parent
port = int(args[0]) if args else 8765
handler = functools.partial(Handler, directory=str(root))
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
