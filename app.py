"""
LocalDrop — Local-network file sharing server.
Compatible with both `python app.py` (dev) and Gunicorn (production).
"""
import os, uuid, socket, mimetypes, secrets, json, time, logging, urllib.parse
from datetime import datetime
from pathlib import Path
from functools import wraps
from logging.handlers import RotatingFileHandler
from flask import (
    Flask, request, jsonify, send_from_directory,
    render_template, session, redirect, url_for, Response,
)
from werkzeug.utils import secure_filename
from werkzeug.http import parse_range_header

# ──────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────

UPLOAD_FOLDER      = Path(__file__).parent / "uploads"
CLIPBOARD_FILE     = Path(__file__).parent / ".clipboard"
MAX_FILE_SIZE      = int(os.environ.get("LOCALDROP_MAX_MB", 500)) * 1024 * 1024
APP_PASSWORD       = os.environ.get("LOCALDROP_PASSWORD", None)
ALLOWED_EXTENSIONS = None
PORT               = int(os.environ.get("LOCALDROP_PORT", 5000))

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
            "ts":      datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "level":   record.levelname,
            "event":   record.getMessage(),
        }
        # Merge any extra kwargs passed to logger.info("…", extra={…})
        for k, v in record.__dict__.items():
            if k not in ("msg","args","levelname","levelno","pathname",
                         "filename","module","exc_info","exc_text",
                         "stack_info","lineno","funcName","created",
                         "msecs","relativeCreated","thread","threadName",
                         "processName","process","name","message"):
                payload[k] = v
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)

_handler = logging.handlers.RotatingFileHandler(
    _LOG_DIR / "app.log", maxBytes=5_000_000, backupCount=3
)
_handler.setFormatter(_JsonFormatter())

log = logging.getLogger("localdrop")
log.setLevel(logging.INFO)
log.addHandler(_handler)
log.addHandler(logging.StreamHandler())   # also print to terminal

_KEY_FILE = Path(__file__).parent / ".secret_key"
if _KEY_FILE.exists():
    SECRET_KEY = _KEY_FILE.read_bytes()
else:
    SECRET_KEY = secrets.token_bytes(32)
    _KEY_FILE.write_bytes(SECRET_KEY)

# ──────────────────────────────────────────────────────────────────
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["UPLOAD_FOLDER"] = str(UPLOAD_FOLDER)

# ─── DO NOT set MAX_CONTENT_LENGTH here ───────────────────────────
# Flask/Werkzeug enforces it by checking the Content-Length *header*
# before the route even runs, then abruptly closes the TCP connection
# mid-transfer — the browser sees this as "network error".
# We enforce the limit ourselves inside the streaming upload route.
# ──────────────────────────────────────────────────────────────────


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
        if   mime.startswith("image"):                                kind = "image"
        elif mime.startswith("video"):                                kind = "video"
        elif mime.startswith("audio"):                                kind = "audio"
        elif "pdf" in mime:                                           kind = "pdf"
        elif any(x in mime for x in ("zip","tar","gzip","rar","7z")): kind = "archive"
        elif mime.startswith("text"):                                 kind = "text"
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
        key=lambda x: x["timestamp"], reverse=True
    )


# ──────────────────────────────────────────────────────────────────
#  Clipboard — file-backed (all Gunicorn workers share it)
# ──────────────────────────────────────────────────────────────────

def clipboard_read() -> list:
    try:
        data = json.loads(CLIPBOARD_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data[::-1]
        return []
    except Exception:
        return []


def clipboard_write(text: str) -> dict:
    try:
        data = json.loads(CLIPBOARD_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            data = []
    except Exception:
        data = []
    new_item = {"text": text, "updated": time.time()}
    data.append(new_item)
    data = data[-20:]
    CLIPBOARD_FILE.write_text(json.dumps(data), encoding="utf-8")
    return new_item


def clipboard_clear() -> None:
    try:
        CLIPBOARD_FILE.unlink()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────
#  Auth
# ──────────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if APP_PASSWORD and not session.get("authenticated"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


# ──────────────────────────────────────────────────────────────────
#  Routes — pages
# ──────────────────────────────────────────────────────────────────

@app.route("/login", methods=["GET", "POST"])
def login():
    if not APP_PASSWORD:
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        if request.form.get("password") == APP_PASSWORD:
            log.info("auth_success", extra={"ip": request.remote_addr})
            session["authenticated"] = True
            return redirect(url_for("index"))
        log.warning("auth_failure", extra={"ip": request.remote_addr})
        error = "Incorrect password."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login" if APP_PASSWORD else "index"))


@app.route("/")
@login_required
def index():
    return render_template(
        "index.html",
        server_url=get_server_url(),
        server_ip=get_local_ip(),
        server_port=PORT,
        password_enabled=bool(APP_PASSWORD),
        max_mb=MAX_FILE_SIZE // (1024 * 1024),
    )


# ──────────────────────────────────────────────────────────────────
#  Routes — Files API
# ──────────────────────────────────────────────────────────────────

@app.route("/api/files")
@login_required
def api_files():
    return jsonify(list_files())


@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload():
    """
    Streaming binary upload — one file per request.

    The JS sends:
        POST /api/upload
        Content-Type: application/octet-stream
        X-Filename: <URL-encoded filename>

    Why streaming instead of multipart FormData?
    ─────────────────────────────────────────────
    Multipart uploads route the file through two copies:
      socket → Werkzeug temp file in /tmp → uploads/
    If /tmp is small (tmpfs, RAM disk, low-space VPS) the temp write
    fails mid-transfer and the browser sees a network error.

    Streaming writes DIRECTLY from the socket to uploads/ in 256 KB
    chunks, using O(1) memory regardless of file size.  No temp file,
    no /tmp dependency, no double I/O.
    """
    # Decode filename from header (URL-encoded to support unicode names)
    raw_name = request.headers.get("X-Filename", "upload")
    try:
        filename = urllib.parse.unquote(raw_name, encoding="utf-8")
    except Exception:
        filename = raw_name

    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    if not allowed_file(filename):
        return jsonify({"error": f"{filename}: file type not allowed"}), 400

    fname = unique_filename(filename)
    dest  = Path(app.config["UPLOAD_FOLDER"]) / fname

    written = 0
    CHUNK   = 256 * 1024   # 256 KB read buffer — small enough to not hog RAM

    try:
        with open(dest, "wb") as out:
            while True:
                chunk = request.stream.read(CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    # Size exceeded — clean up partial file and reject
                    out.close()
                    dest.unlink(missing_ok=True)
                    return jsonify({
                        "error": f"File exceeds the {MAX_FILE_SIZE // (1024*1024)} MB limit"
                    }), 413
                out.write(chunk)
    except OSError as e:
            dest.unlink(missing_ok=True)
            log.error("upload_disk_error", extra={
                "file": fname, "error": e.strerror, "ip": request.remote_addr
            })
            return jsonify({"error": f"Disk write failed: {e.strerror}"}), 500

    if written == 0:
        dest.unlink(missing_ok=True)
        return jsonify({"error": "Received empty file"}), 400

    log.info("upload_complete", extra={
            "file":   fname,
            "size":   written,
            "ip":     request.remote_addr,
        })
    return jsonify({"uploaded": [file_info(dest)], "warnings": []}), 200


@app.route("/api/delete/<filename>", methods=["DELETE"])
@login_required
def api_delete(filename):
    safe = secure_filename(filename)
    path = Path(app.config["UPLOAD_FOLDER"]) / safe
    if not path.is_file():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
    log.info("file_deleted", extra={"file": safe, "ip": request.remote_addr})
    return jsonify({"deleted": safe}), 200


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
#  Routes — File delivery & utilities
# ──────────────────────────────────────────────────────────────────

@app.route("/download/<filename>")
@login_required
def download(filename):
    """
    Resumable download via HTTP Range requests.

    The browser (or curl/wget) can send:
        Range: bytes=0-          → full file (normal)
        Range: bytes=1048576-    → resume from 1 MB in

    This lets an interrupted download continue without restarting.
    send_from_directory doesn't support Range natively, so we stream
    manually.  We send Accept-Ranges: bytes so browsers know they can.
    """
    safe  = secure_filename(filename)
    path  = Path(app.config["UPLOAD_FOLDER"]) / safe

    if not path.is_file():
        log.warning("download_not_found", extra={"file": safe,
                    "ip": request.remote_addr})
        return jsonify({"error": "File not found"}), 404

    size = path.stat().st_size

    # ── Parse Range header ────────────────────────────────────────
    range_header = request.headers.get("Range")
    start, end   = 0, size - 1          # defaults: full file

    if range_header:
        parsed = parse_range_header(range_header)
        if parsed and parsed.units == "bytes":
            rng   = parsed.ranges[0]        # (start, stop) — stop is exclusive
            start = rng[0] if rng[0] is not None else 0
            end   = (rng[1] - 1) if rng[1] is not None else size - 1
        start = max(0, start)
        end   = min(end, size - 1)

    length      = end - start + 1
    is_partial  = (start != 0 or end != size - 1)
    http_status = 206 if is_partial else 200

    log.info("download_start", extra={
        "file":    safe,
        "size":    size,
        "start":   start,
        "end":     end,
        "partial": is_partial,
        "ip":      request.remote_addr,
    })

    CHUNK = 256 * 1024      # 256 KB chunks — good for streaming over WiFi

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
        log.info("download_complete", extra={"file": safe,
                 "bytes_sent": length, "ip": request.remote_addr})

    mime = mimetypes.guess_type(safe)[0] or "application/octet-stream"

    headers = {
        "Content-Disposition":  f'attachment; filename="{safe}"',
        "Content-Type":         mime,
        "Content-Length":       str(length),
        "Accept-Ranges":        "bytes",
        "Content-Range":        f"bytes {start}-{end}/{size}" if is_partial else f"bytes 0-{end}/{size}",
        "Cache-Control":        "no-store",
    }

    return Response(stream_file(), status=http_status,
                    headers=headers, direct_passthrough=True)


@app.route("/qr")
@login_required
def qr_code():
    return jsonify({"url": get_server_url()})


@app.route("/health")
def health():
    return jsonify({"status": "ok", "ip": get_local_ip(), "port": PORT})


# ──────────────────────────────────────────────────────────────────
#  Error handlers
# ──────────────────────────────────────────────────────────────────

@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": f"File exceeds the {MAX_FILE_SIZE//(1024*1024)} MB limit"}), 413

@app.errorhandler(404)
def not_found(_):
    return jsonify({"error": "Not found"}), 404


# ──────────────────────────────────────────────────────────────────
#  Dev entry point
# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ip = get_local_ip()
    print("\n" + "═" * 56)
    print("  📡  LocalDrop — development server")
    print("═" * 56)
    print(f"  Local   ▸  http://localhost:{PORT}")
    print(f"  Network ▸  http://{ip}:{PORT}")
    print(f"  Max     ▸  {MAX_FILE_SIZE//(1024*1024)} MB per file")
    print("═" * 56 + "\n")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)