"""
LocalDrop — Local-network file sharing server.
Compatible with both `python app.py` (dev) and Gunicorn (production).
"""

import os
import uuid
import socket
import mimetypes
import secrets
import json
import time
from datetime import datetime
from pathlib import Path
from functools import wraps

from flask import (
    Flask, request, jsonify, send_from_directory,
    render_template, session, redirect, url_for,
)
from werkzeug.utils import secure_filename

# ──────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────

UPLOAD_FOLDER      = Path(__file__).parent / "uploads"
CLIPBOARD_FILE     = Path(__file__).parent / ".clipboard"   # file-backed so all Gunicorn workers share it
MAX_FILE_SIZE      = 500 * 1024 * 1024
APP_PASSWORD = os.environ.get("LOCALDROP_PASSWORD", None)
ALLOWED_EXTENSIONS = None
PORT               = int(os.environ.get("LOCALDROP_PORT", 5000))

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
app.config["UPLOAD_FOLDER"]      = str(UPLOAD_FOLDER)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE


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
#  Clipboard — file-backed so all Gunicorn workers read the same data
# ──────────────────────────────────────────────────────────────────
def clipboard_read() -> list:
    try:
        data = json.loads(CLIPBOARD_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data[::-1]  # latest first
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

    # optional: limit history size (say last 20)
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
            session["authenticated"] = True
            return redirect(url_for("index"))
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
    if "files" not in request.files:
        return jsonify({"error": "No files field in request"}), 400
    uploaded, errors = [], []
    for f in request.files.getlist("files"):
        if not f or not f.filename:
            continue
        if not allowed_file(f.filename):
            errors.append(f"{f.filename}: type not allowed")
            continue
        fname = unique_filename(f.filename)
        dest  = Path(app.config["UPLOAD_FOLDER"]) / fname
        f.save(str(dest))
        uploaded.append(file_info(dest))
    if not uploaded and errors:
        return jsonify({"error": "; ".join(errors)}), 400
    return jsonify({"uploaded": uploaded, "warnings": errors}), 200


@app.route("/api/delete/<filename>", methods=["DELETE"])
@login_required
def api_delete(filename):
    safe = secure_filename(filename)
    path = Path(app.config["UPLOAD_FOLDER"]) / safe
    if not path.is_file():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
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
    if len(text) > 100_000:                     # 100 KB cap
        return jsonify({"error": "Text too long (max 100 KB)"}), 400
    data = clipboard_write(text)
    return jsonify(data), 200


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
    return send_from_directory(
        app.config["UPLOAD_FOLDER"],
        secure_filename(filename),
        as_attachment=True,
    )


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
    print("═" * 56 + "\n")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)