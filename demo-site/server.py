"""Endpoint directory and controllable demo health check."""
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Lock

CONTROL_TOKEN = os.environ.get("DEMO_CONTROL_TOKEN", "")
if len(CONTROL_TOKEN) < 24 or CONTROL_TOKEN.startswith("REPLACE_"):
    raise SystemExit("Set DEMO_CONTROL_TOKEN to a random secret of at least 24 characters")

INDEX_PAGE = Path(__file__).with_name("index.html").read_bytes()
state = {"up": True}
lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def send_payload(self, code, content, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def reply(self, code, body):
        self.send_payload(code, json.dumps(body).encode(), "application/json")

    def do_GET(self):
        if self.path == "/":
            return self.send_payload(200, INDEX_PAGE, "text/html; charset=utf-8")
        if self.path != "/health":
            return self.reply(404, {"error": "Not found"})
        with lock:
            up = state["up"]
        self.reply(200 if up else 503, {"status": "up" if up else "down", "service": "SLA Guard demo website"})

    def do_POST(self):
        if self.path not in ("/admin/up", "/admin/down"):
            return self.reply(404, {"error": "Not found"})
        expected = "Bearer " + CONTROL_TOKEN
        if not compare_digest(self.headers.get("Authorization", ""), expected):
            return self.reply(401, {"error": "Unauthorized"})
        with lock:
            state["up"] = self.path == "/admin/up"
            up = state["up"]
        self.reply(200, {"status": "up" if up else "down"})


if __name__ == "__main__":
    print("Demo website listening on 0.0.0.0:8000; initial state: UP", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
