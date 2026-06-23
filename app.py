"""
LocalDrop — Local-network file sharing server.
Standalone API mode — designed for a separate React/Vite frontend.
Compatible with both `python app.py` (dev) and Gunicorn (production).

New in API mode
───────────────
• Auth       : Bearer token (Authorization: Bearer <token>) instead of sessions.
               POST /api/auth/login  → {"token": "..."}
               POST /api/auth/logout
               GET  /api/auth/status
• CORS       : All /api/* and /download/* routes allow cross-origin requests
               so the React dev server (localhost:5173) can talk to the API.
• Bulk ops   : POST /api/delete   {"filenames": [...]}  → deletes many at once
               POST /api/download {"filenames": [...]}  → streams a ZIP archive
• Server info: GET /api/server-info  (replaces index template variables)
• Removed    : render_template, redirect, Jinja2 routes, /qr, /login page

Dependencies (pip install):
    flask flask-cors werkzeug
"""

import io
import json
import logging
import mimetypes
import os
import secrets
import socket
import time
import urllib.parse
import uuid
import zipfile
from datetime import datetime
from functools import wraps
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from werkzeug.http import parse_range_header
from werkzeug.utils import secure_filename


# ──────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────

UPLOAD_FOLDER      = Path(__file__).parent / "uploads"
CLIPBOARD_FILE     = Path(__file__).parent / ".clipboard"
MAX_FILE_SIZE      = int(os.environ.get("LOCALDROP_MAX_MB", 500)) * 1024 * 1024
APP_PASSWORD       = os.environ.get("LOCALDROP_PASSWORD", None)
ALLOWED_EXTENSIONS = None   # None = all types allowed; set to {"jpg","png",...} to restrict
PORT               = int(os.environ.get("LOCALDROP_PORT", 5000))

# In-memory token store — cleared on restart.
# For persistent tokens across restarts, replace with a file or DB.
_VALID_TOKENS: set[str] = set()


# ──────────────────────────────────────────────────────────────────
#  Structured JSON logger
#  All events (uploads, downloads, auth, errors) go to logs/app.log
# ──────────────────────────────────────────────────────────────────

_LOG_DIR = Path(__file__).parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log line — easy to grep / ship to ELK."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":    datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "level": record.levelname,
            "event": record.getMessage(),
        }
        _skip = {
            "msg", "args", "levelname", "levelno", "pathname", "filename",
            "module", "exc_info", "exc_text", "stack_info", "lineno",
            "funcName", "created", "msecs", "relativeCreated", "thread",
            "threadName", "processName", "process", "name", "message",
        }
        for k, v in record.__dict__.items():
            if k not in _skip:
                payload[k] = v
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_handler = RotatingFileHandler(
    _LOG_DIR / "app.log", maxBytes=5_000_000, backupCount=3
)
_handler.setFormatter(_JsonFormatter())

log = logging.getLogger("localdrop")
log.setLevel(logging.INFO)
log.addHandler(_handler)
log.addHandler(logging.StreamHandler())  # also print to terminal


# ──────────────────────────────────────────────────────────────────
#  Secret key (persisted so tokens survive gunicorn worker recycles)
# ──────────────────────────────────────────────────────────────────

_KEY_FILE = Path(__file__).parent / ".secret_key"
if _KEY_FILE.exists():
    SECRET_KEY = _KEY_FILE.read_bytes()
else:
    SECRET_KEY = secrets.token_bytes(32)
    _KEY_FILE.write_bytes(SECRET_KEY)

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────────────
#  App + CORS
# ──────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["UPLOAD_FOLDER"] = str(UPLOAD_FOLDER)

# Allow any origin on API and download routes.
# In production, restrict origins to your actual domain:
#   origins=["https://your-domain.com"]
CORS(app, resources={
    r"/api/*":       {"origins": "*", "expose_headers": ["Content-Disposition"]},
    r"/download/*":  {"origins": "*", "expose_headers": ["Content-Disposition", "Content-Length", "Content-Range"]},
    r"/health":      {"origins": "*"},
}, supports_credentials=False)


# ──────────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────────

def get_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0)
            s.connect(("10.254.254.254", 1))
            return s.getsockname()[0]
    except Exception:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"


def get_server_url() -> str:
    return f"http://{get_local_ip()}:{PORT}"


def allowed_file(filename: str) -> bool:
    if ALLOWED_EXTENSIONS is None:
        return True
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in ALLOWED_EXTENSIONS


def unique_filename(original: str) -> str:
    safe   = secure_filename(original)
    stem   = Path(safe).stem or "file"
    suffix = Path(safe).suffix
    return f"{stem}_{uuid.uuid4().hex[:8]}{suffix}"


def _human_size(nbytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if nbytes < 1024:
            return f"{nbytes:.1f} {unit}"
        nbytes /= 1024
    return f"{nbytes:.1f} PB"


def file_info(path: Path) -> dict:
    stat = path.stat()
    mime, _ = mimetypes.guess_type(path.name)
    kind = "other"
    if mime:
        if   mime.startswith("image"):                                    kind = "image"
        elif mime.startswith("video"):                                    kind = "video"
        elif mime.startswith("audio"):                                    kind = "audio"
        elif "pdf" in mime:                                               kind = "pdf"
        elif any(x in mime for x in ("zip", "tar", "gzip", "rar", "7z")): kind = "archive"
        elif mime.startswith("text"):                                     kind = "text"
    return {
        "name":       path.name,
        "size":       stat.st_size,
        "size_human": _human_size(stat.st_size),
        "uploaded":   datetime.fromtimestamp(stat.st_mtime).strftime("%d %b %Y, %H:%M"),
        "timestamp":  stat.st_mtime,
        "kind":       kind,
        "mime":       mime or "application/octet-stream",
    }


def list_files() -> list:
    folder = Path(app.config["UPLOAD_FOLDER"])
    return sorted(
        [file_info(f) for f in folder.iterdir() if f.is_file()],
        key=lambda x: x["timestamp"],
        reverse=True,
    )


# ──────────────────────────────────────────────────────────────────
#  Clipboard — file-backed (all Gunicorn workers share it)
# ──────────────────────────────────────────────────────────────────

def clipboard_read() -> list:
    try:
        data = json.loads(CLIPBOARD_FILE.read_text(encoding="utf-8"))
        return data[::-1] if isinstance(data, list) else []
    except Exception:
        return []


def clipboard_write(text: str) -> dict:
    try:
        data = json.loads(CLIPBOARD_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            data = []
    except Exception:
        data = []
    item = {"text": text, "updated": time.time()}
    data.append(item)
    CLIPBOARD_FILE.write_text(json.dumps(data[-20:]), encoding="utf-8")
    return item


def clipboard_clear() -> None:
    try:
        CLIPBOARD_FILE.unlink()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────
#  Auth — Bearer token
#
#  React frontend flow:
#    1. GET  /api/auth/status  → find out if a password is required
#    2. POST /api/auth/login   → get a token, store it in localStorage
#    3. Send Authorization: Bearer <token> on every protected request
#    4. POST /api/auth/logout  → discard the token
# ──────────────────────────────────────────────────────────────────

def _extract_token() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not APP_PASSWORD:
            return f(*args, **kwargs)          # open access — no password set
        token = _extract_token()
        if not token or token not in _VALID_TOKENS:
            return jsonify({"error": "Unauthorized — please login first"}), 401
        return f(*args, **kwargs)
    return decorated


# ──────────────────────────────────────────────────────────────────
#  Routes — Auth API
# ──────────────────────────────────────────────────────────────────

@app.route("/api/auth/status", methods=["GET"])
def api_auth_status():
    """
    GET /api/auth/status
    Returns whether a password is configured and whether the caller's token is valid.
    React can call this on startup to decide whether to show a login screen.
    """
    token         = _extract_token()
    authenticated = (not APP_PASSWORD) or bool(token and token in _VALID_TOKENS)
    return jsonify({
        "passwordRequired": bool(APP_PASSWORD),
        "authenticated":    authenticated,
    }), 200


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """
    POST /api/auth/login
    Body:    {"password": "secret"}
    Returns: {"token": "...", "passwordRequired": true}   on success
             {"error":  "..."}                            on failure
    """
    if not APP_PASSWORD:
        # No password configured — issue an open-access token anyway so
        # the React app can store it and use the same auth header flow.
        token = secrets.token_urlsafe(32)
        _VALID_TOKENS.add(token)
        return jsonify({"token": token, "passwordRequired": False}), 200

    body     = request.get_json(silent=True) or {}
    password = body.get("password", "")

    if password == APP_PASSWORD:
        token = secrets.token_urlsafe(32)
        _VALID_TOKENS.add(token)
        log.info("auth_success", extra={"ip": request.remote_addr})
        return jsonify({"token": token, "passwordRequired": True}), 200

    log.warning("auth_failure", extra={"ip": request.remote_addr})
    return jsonify({"error": "Incorrect password"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """
    POST /api/auth/logout
    Invalidates the caller's Bearer token server-side.
    """
    token = _extract_token()
    if token:
        _VALID_TOKENS.discard(token)
    return jsonify({"success": True}), 200


# ──────────────────────────────────────────────────────────────────
#  Routes — Files API
# ──────────────────────────────────────────────────────────────────

@app.route("/api/files", methods=["GET"])
@login_required
def api_files():
    """
    GET /api/files
    Returns a list of all uploaded files sorted newest-first.
    """
    return jsonify(list_files())


@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload():
    """
    Streaming binary upload — one file per request.

    Headers:
        Authorization: Bearer <token>
        Content-Type:  application/octet-stream
        X-Filename:    <URL-encoded original filename>

    Why streaming instead of multipart FormData?
    ─────────────────────────────────────────────
    Multipart routes the file through two copies:
        socket → Werkzeug temp file in /tmp → uploads/
    Streaming writes DIRECTLY from the socket to uploads/ in 256 KB
    chunks using O(1) memory. No temp file, no /tmp dependency.
    """
    raw_name = request.headers.get("X-Filename", "upload")
    try:
        filename = urllib.parse.unquote(raw_name, encoding="utf-8")
    except Exception:
        filename = raw_name

    if not filename:
        return jsonify({"error": "No filename provided"}), 400
    if not allowed_file(filename):
        return jsonify({"error": f"{filename}: file type not allowed"}), 400

    fname   = unique_filename(filename)
    dest    = Path(app.config["UPLOAD_FOLDER"]) / fname
    written = 0
    CHUNK   = 256 * 1024   # 256 KB read buffer

    try:
        with open(dest, "wb") as out:
            while True:
                chunk = request.stream.read(CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    return jsonify({
                        "error": f"File exceeds the {MAX_FILE_SIZE // (1024 * 1024)} MB limit"
                    }), 413
                out.write(chunk)
    except OSError as e:
        dest.unlink(missing_ok=True)
        log.error("upload_disk_error", extra={
            "file": fname, "error": e.strerror, "ip": request.remote_addr,
        })
        return jsonify({"error": f"Disk write failed: {e.strerror}"}), 500

    if written == 0:
        dest.unlink(missing_ok=True)
        return jsonify({"error": "Received empty file"}), 400

    log.info("upload_complete", extra={"file": fname, "size": written, "ip": request.remote_addr})
    return jsonify({"uploaded": [file_info(dest)], "warnings": []}), 200


# ── Single delete ─────────────────────────────────────────────────

@app.route("/api/delete/<filename>", methods=["DELETE"])
@login_required
def api_delete(filename):
    """
    DELETE /api/delete/<filename>
    Deletes a single file by name.
    """
    safe = secure_filename(filename)
    path = Path(app.config["UPLOAD_FOLDER"]) / safe
    if not path.is_file():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
    log.info("file_deleted", extra={"file": safe, "ip": request.remote_addr})
    return jsonify({"deleted": safe}), 200


# ── Bulk delete ───────────────────────────────────────────────────

@app.route("/api/delete", methods=["POST"])
@login_required
def api_delete_bulk():
    """
    POST /api/delete
    Body:    {"filenames": ["a.jpg", "b.pdf", ...]}
    Returns: {"deleted": [...], "errors": [...]}

    Partial success is allowed — files that exist get deleted, missing
    ones are reported in `errors` without aborting the whole batch.
    """
    body      = request.get_json(silent=True) or {}
    filenames = body.get("filenames", [])

    if not isinstance(filenames, list) or not filenames:
        return jsonify({"error": "filenames must be a non-empty array"}), 400

    deleted, errors = [], []
    for name in filenames:
        safe = secure_filename(str(name))
        path = Path(app.config["UPLOAD_FOLDER"]) / safe
        if not path.is_file():
            errors.append({"file": safe, "reason": "not found"})
            continue
        try:
            path.unlink()
            deleted.append(safe)
            log.info("file_deleted", extra={"file": safe, "ip": request.remote_addr})
        except OSError as e:
            errors.append({"file": safe, "reason": e.strerror})

    return jsonify({"deleted": deleted, "errors": errors}), 200


# ──────────────────────────────────────────────────────────────────
#  Routes — Download (single + bulk ZIP)
# ──────────────────────────────────────────────────────────────────

@app.route("/download/<filename>")
@login_required
def download(filename):
    """
    GET /download/<filename>
    Resumable single-file download via HTTP Range requests.

    The browser (or curl/wget) can send:
        Range: bytes=0-          → full file (normal)
        Range: bytes=1048576-    → resume from 1 MB in

    send_from_directory doesn't support Range natively, so we stream
    manually. We send Accept-Ranges: bytes so browsers know they can.
    """
    safe = secure_filename(filename)
    path = Path(app.config["UPLOAD_FOLDER"]) / safe

    if not path.is_file():
        log.warning("download_not_found", extra={"file": safe, "ip": request.remote_addr})
        return jsonify({"error": "File not found"}), 404

    size         = path.stat().st_size
    range_header = request.headers.get("Range")
    start, end   = 0, size - 1

    if range_header:
        parsed = parse_range_header(range_header)
        if parsed and parsed.units == "bytes":
            rng   = parsed.ranges[0]   # (start, stop) — stop is exclusive
            start = rng[0] if rng[0] is not None else 0
            end   = (rng[1] - 1) if rng[1] is not None else size - 1
        start = max(0, start)
        end   = min(end, size - 1)

    length      = end - start + 1
    is_partial  = start != 0 or end != size - 1
    http_status = 206 if is_partial else 200

    log.info("download_start", extra={
        "file": safe, "size": size, "start": start,
        "end": end, "partial": is_partial, "ip": request.remote_addr,
    })

    CHUNK = 256 * 1024  # 256 KB chunks — good for streaming over Wi-Fi

    def stream_file():
        remaining = length
        with open(path, "rb") as fh:
            fh.seek(start)
            while remaining > 0:
                data = fh.read(min(CHUNK, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data
        log.info("download_complete", extra={
            "file": safe, "bytes_sent": length, "ip": request.remote_addr,
        })

    mime    = mimetypes.guess_type(safe)[0] or "application/octet-stream"
    headers = {
        "Content-Disposition": f'attachment; filename="{safe}"',
        "Content-Type":        mime,
        "Content-Length":      str(length),
        "Accept-Ranges":       "bytes",
        "Content-Range":       f"bytes {start}-{end}/{size}",
        "Cache-Control":       "no-store",
    }

    return Response(stream_file(), status=http_status,
                    headers=headers, direct_passthrough=True)


@app.route("/api/download", methods=["POST"])
@login_required
def api_download_bulk():
    """
    POST /api/download
    Body:    {"filenames": ["a.jpg", "b.pdf", ...]}
    Returns: application/zip stream named "localdrop_selection.zip"

    All requested files are compressed into a single ZIP and streamed
    back to the client. Files that don't exist are silently skipped
    (the `missing` field in logs records them).

    Note: the ZIP is built in memory before streaming. For very large
    selections on memory-constrained hosts, consider adding a temp-file
    fallback — but for typical LAN file-sharing this is fine.
    """
    body      = request.get_json(silent=True) or {}
    filenames = body.get("filenames", [])

    if not isinstance(filenames, list) or not filenames:
        return jsonify({"error": "filenames must be a non-empty array"}), 400

    folder  = Path(app.config["UPLOAD_FOLDER"])
    paths   = []
    missing = []

    for name in filenames:
        safe = secure_filename(str(name))
        path = folder / safe
        if path.is_file():
            paths.append((safe, path))
        else:
            missing.append(safe)

    if not paths:
        return jsonify({"error": "None of the requested files were found"}), 404

    log.info("bulk_download_start", extra={
        "files":   [p[0] for p in paths],
        "missing": missing,
        "ip":      request.remote_addr,
    })

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for safe_name, path in paths:
            zf.write(path, arcname=safe_name)
    zip_bytes = buf.getvalue()

    log.info("bulk_download_ready", extra={
        "zip_size": len(zip_bytes), "ip": request.remote_addr,
    })

    CHUNK = 256 * 1024

    def stream_zip():
        offset = 0
        while offset < len(zip_bytes):
            yield zip_bytes[offset: offset + CHUNK]
            offset += CHUNK

    headers = {
        "Content-Disposition": 'attachment; filename="localdrop_selection.zip"',
        "Content-Type":        "application/zip",
        "Content-Length":      str(len(zip_bytes)),
        "Cache-Control":       "no-store",
    }

    return Response(stream_zip(), status=200, headers=headers)


# ──────────────────────────────────────────────────────────────────
#  Routes — Clipboard API
# ──────────────────────────────────────────────────────────────────

@app.route("/api/clipboard", methods=["GET"])
def api_clipboard_get():
    return jsonify({"items": clipboard_read()})


@app.route("/api/clipboard", methods=["POST"])
@login_required
def api_clipboard_post():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "")
    if len(text) > 100_000:
        return jsonify({"error": "Text too long (max 100 KB)"}), 400
    return jsonify(clipboard_write(text)), 200


@app.route("/api/clipboard", methods=["DELETE"])
@login_required
def api_clipboard_delete():
    clipboard_clear()
    return jsonify({"text": "", "updated": 0}), 200


# ──────────────────────────────────────────────────────────────────
#  Routes — Server info & health
# ──────────────────────────────────────────────────────────────────

@app.route("/api/server-info", methods=["GET"])
@login_required
def api_server_info():
    """
    GET /api/server-info
    Returns the info that was previously embedded in the index.html template.
    React can call this once on mount to display the LAN URL / QR code.
    """
    return jsonify({
        "url":             get_server_url(),
        "ip":              get_local_ip(),
        "port":            PORT,
        "passwordEnabled": bool(APP_PASSWORD),
        "maxMB":           MAX_FILE_SIZE // (1024 * 1024),
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "ip": get_local_ip(), "port": PORT})


# ──────────────────────────────────────────────────────────────────
#  Error handlers — always return JSON (no HTML pages)
# ──────────────────────────────────────────────────────────────────

@app.errorhandler(400)
def bad_request(_):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(_):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(_):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": f"File exceeds the {MAX_FILE_SIZE // (1024 * 1024)} MB limit"}), 413

@app.errorhandler(500)
def server_error(_):
    return jsonify({"error": "Internal server error"}), 500


# ──────────────────────────────────────────────────────────────────
#  Dev entry point
# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ip = get_local_ip()
    print("\n" + "═" * 60)
    print("  📡  LocalDrop — API server (React-compatible)")
    print("═" * 60)
    print(f"  Local   ▸  http://localhost:{PORT}")
    print(f"  Network ▸  http://{ip}:{PORT}")
    print(f"  Max     ▸  {MAX_FILE_SIZE // (1024 * 1024)} MB per file")
    print(f"  Auth    ▸  {'Password protected' if APP_PASSWORD else 'Open (no password set)'}")
    print("═" * 60)
    print("  Endpoints:")
    print("  POST  /api/auth/login        → get Bearer token")
    print("  GET   /api/auth/status       → check auth state")
    print("  POST  /api/auth/logout       → invalidate token")
    print("  GET   /api/files             → list files")
    print("  POST  /api/upload            → upload one file")
    print("  DELETE /api/delete/<name>    → delete one file")
    print("  POST  /api/delete            → delete many files")
    print("  GET   /download/<name>       → download one file (resumable)")
    print("  POST  /api/download          → download many files as ZIP")
    print("  GET   /api/server-info       → LAN URL, port, limits")
    print("  GET   /health                → health check (no auth)")
    print("═" * 60 + "\n")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)