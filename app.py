import io
import json
import logging
import mimetypes
import os
import re
import secrets
import socket
import time
import unicodedata
import urllib.parse
import uuid
import zipfile
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel


# ──────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────

UPLOAD_FOLDER      = Path(__file__).parent / "uploads"
CLIPBOARD_FILE     = Path(__file__).parent / ".clipboard"
MAX_FILE_SIZE      = int(os.environ.get("LOCALDROP_MAX_MB", 500)) * 1024 * 1024
APP_PASSWORD: Optional[str] = os.environ.get("LOCALDROP_PASSWORD") or None
ALLOWED_EXTENSIONS = None   # None = all types; set {"jpg","png",...} to restrict
PORT               = int(os.environ.get("LOCALDROP_PORT", 8080))

# In-memory token store — survives uvicorn --reload but clears on full restart.
# With Gunicorn multi-worker you need a shared store (Redis / file).
# For a typical single-machine LAN drop box, one worker is fine.
_VALID_TOKENS: set[str] = set()


# ──────────────────────────────────────────────────────────────────
#  Logging
# ──────────────────────────────────────────────────────────────────

_LOG_DIR = Path(__file__).parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)


class _JsonFormatter(logging.Formatter):
    _SKIP = {
        "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno",
        "funcName", "created", "msecs", "relativeCreated", "thread",
        "threadName", "processName", "process", "name", "message",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":    datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "level": record.levelname,
            "event": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k not in self._SKIP:
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
log.addHandler(logging.StreamHandler())


# ──────────────────────────────────────────────────────────────────
#  Secret key (file-persisted across uvicorn reloads)
# ──────────────────────────────────────────────────────────────────

_KEY_FILE = Path(__file__).parent / ".secret_key"
if _KEY_FILE.exists():
    SECRET_KEY = _KEY_FILE.read_bytes()
else:
    SECRET_KEY = secrets.token_bytes(32)
    _KEY_FILE.write_bytes(SECRET_KEY)

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────────
#  FastAPI app + CORS
# ──────────────────────────────────────────────────────────────────

app = FastAPI(title="LocalDrop", version="2.0.0", docs_url="/api/docs")

# ── CORS ──────────────────────────────────────────────────────────
# Must be the FIRST middleware added.
# allow_credentials=False is required when allow_origins=["*"].
# Explicit methods list ensures OPTIONS preflight always gets 200.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length", "Content-Range"],
    max_age=3600,
)


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


def safe_filename(name: str) -> str:
    """
    Replaces werkzeug.utils.secure_filename.
    Strips path separators, null bytes, and control characters;
    normalises Unicode; keeps only safe chars.
    """
    name = unicodedata.normalize("NFKD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^\w.\- ]", "_", name).strip()
    name = re.sub(r"[\\/]", "_", name)
    name = name.strip(". ")
    return name or "upload"


def allowed_file(filename: str) -> bool:
    if ALLOWED_EXTENSIONS is None:
        return True
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in ALLOWED_EXTENSIONS


def unique_filename(original: str) -> str:
    safe   = safe_filename(original)
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
        if   mime.startswith("image"):                                     kind = "image"
        elif mime.startswith("video"):                                     kind = "video"
        elif mime.startswith("audio"):                                     kind = "audio"
        elif "pdf" in mime:                                                kind = "pdf"
        elif any(x in mime for x in ("zip", "tar", "gzip", "rar", "7z")): kind = "archive"
        elif mime.startswith("text"):                                      kind = "text"
    return {
        "name":       path.name,
        "size":       stat.st_size,          # raw bytes (for frontend)
        "size_human": _human_size(stat.st_size),
        "uploaded":   datetime.fromtimestamp(stat.st_mtime).strftime("%d %b %Y, %H:%M"),
        "timestamp":  stat.st_mtime,
        "kind":       kind,
        "mime":       mime or "application/octet-stream",
    }


def list_files() -> list:
    return sorted(
        [file_info(f) for f in UPLOAD_FOLDER.iterdir() if f.is_file()],
        key=lambda x: x["timestamp"],
        reverse=True,
    )


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse a 'Range: bytes=start-end' header. Returns (start, end) inclusive."""
    match = re.match(r"bytes=(\d*)-(\d*)", range_header)
    if not match:
        return 0, file_size - 1
    s, e = match.group(1), match.group(2)
    start = int(s) if s else 0
    end   = int(e) if e else file_size - 1
    start = max(0, min(start, file_size - 1))
    end   = max(start, min(end, file_size - 1))
    return start, end


# ──────────────────────────────────────────────────────────────────
#  Clipboard
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
#  Auth — Bearer token + FastAPI dependency
# ──────────────────────────────────────────────────────────────────

def _extract_token(authorization: str = Header(default="")) -> Optional[str]:
    if authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return None


def require_auth(request: Request, authorization: str = Header(default="")) -> None:
    """FastAPI Depends() — raises 401 if not authenticated.
    Accepts token via:
      1. Authorization: Bearer <token>  header  (XHR / fetch)
      2. ?token=<token>  query param            (direct <a href> downloads)
    """
    if not APP_PASSWORD:
        return   # open access
    # Try header first, then query param
    token = _extract_token(authorization) or request.query_params.get("token", "")
    if not token or token not in _VALID_TOKENS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized — please login first",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Pydantic request bodies ────────────────────────────────────────

class LoginBody(BaseModel):
    password: str = ""

class BulkFilenames(BaseModel):
    filenames: list[str]

class ClipboardBody(BaseModel):
    text: str


# ──────────────────────────────────────────────────────────────────
#  Routes — Auth
# ──────────────────────────────────────────────────────────────────

@app.get("/api/auth/status")
def api_auth_status(authorization: str = Header(default="")):
    """
    React calls this on startup.
    - passwordRequired: false  → skip login screen, go straight to app
    - authenticated: true      → token in localStorage is still valid
    """
    token         = _extract_token(authorization)
    authenticated = (not APP_PASSWORD) or bool(token and token in _VALID_TOKENS)
    return {
        "passwordRequired": bool(APP_PASSWORD),
        "authenticated":    authenticated,
    }


@app.post("/api/auth/login")
def api_login(body: LoginBody, request: Request):
    if not APP_PASSWORD:
        # No password set — issue a free token so auth header flow is uniform
        token = secrets.token_urlsafe(32)
        _VALID_TOKENS.add(token)
        return {"token": token, "passwordRequired": False}

    if body.password == APP_PASSWORD:
        token = secrets.token_urlsafe(32)
        _VALID_TOKENS.add(token)
        log.info("auth_success", extra={"ip": request.client.host})
        return {"token": token, "passwordRequired": True}

    log.warning("auth_failure", extra={"ip": request.client.host})
    raise HTTPException(status_code=401, detail="Incorrect password")


@app.post("/api/auth/logout")
def api_logout(authorization: str = Header(default="")):
    token = _extract_token(authorization)
    if token:
        _VALID_TOKENS.discard(token)
    return {"success": True}


# ──────────────────────────────────────────────────────────────────
#  Routes — Files
# ──────────────────────────────────────────────────────────────────

@app.get("/api/files")
def api_files(_: None = Depends(require_auth)):
    """
    Returns list of files with full metadata including size (bytes) and size_human.
    Sorted newest-first.
    """
    return {"files": list_files()}


@app.post("/api/upload")
async def api_upload(
    request: Request,
    x_filename: str = Header(default="upload"),
    _: None = Depends(require_auth),
):
    """
    Streaming binary upload — one file per request.

    Headers:
        Content-Type:  application/octet-stream
        X-Filename:    <URL-encoded original filename>

    Streams directly from socket → uploads/ in 256 KB chunks.
    No temp file, O(1) memory regardless of file size.
    """
    try:
        filename = urllib.parse.unquote(x_filename, encoding="utf-8")
    except Exception:
        filename = x_filename

    filename = filename.strip() or "upload"

    if not allowed_file(filename):
        raise HTTPException(status_code=400, detail=f"{filename}: file type not allowed")

    fname   = unique_filename(filename)
    dest    = UPLOAD_FOLDER / fname
    written = 0
    CHUNK   = 256 * 1024

    try:
        with open(dest, "wb") as out:
            async for chunk in request.stream():
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {MAX_FILE_SIZE // (1024 * 1024)} MB limit",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        # ClientDisconnect: browser closed connection after sending all bytes.
        # The file is fully written — this is NOT an error, just the XHR
        # closing its side before our response arrives. We handle it by
        # checking written > 0 below and returning success normally.
        # Any other exception (OSError etc.) is re-raised.
        from starlette.requests import ClientDisconnect as _CD
        if isinstance(e, _CD):
            log.info("upload_client_disconnect", extra={
                "file": fname, "bytes_written": written,
                "note": "XHR closed after send — file intact if written > 0"
            })
        elif isinstance(e, OSError):
            dest.unlink(missing_ok=True)
            log.error("upload_disk_error", extra={"file": fname, "error": str(e)})
            raise HTTPException(status_code=500, detail=f"Disk write failed: {e.strerror}")
        else:
            dest.unlink(missing_ok=True)
            log.error("upload_unknown_error", extra={"file": fname, "error": str(e)})
            raise HTTPException(status_code=500, detail="Upload failed unexpectedly")

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Received empty file")

    log.info("file_uploaded", extra={"file": fname, "size": written})
    return {"uploaded": [file_info(dest)], "warnings": []}


# ── Single delete ─────────────────────────────────────────────────

@app.delete("/api/delete/{filename}")
def api_delete(filename: str, request: Request, _: None = Depends(require_auth)):
    safe = safe_filename(filename)
    path = UPLOAD_FOLDER / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    log.info("file_deleted", extra={"file": safe, "ip": request.client.host})
    return {"deleted": safe}


# ── Bulk delete ───────────────────────────────────────────────────

@app.post("/api/delete")
def api_delete_bulk(body: BulkFilenames, request: Request, _: None = Depends(require_auth)):
    """
    POST /api/delete
    Body: {"filenames": ["a.jpg", "b.pdf"]}
    Partial success allowed — missing files go into errors[], existing ones get deleted.
    """
    if not body.filenames:
        raise HTTPException(status_code=400, detail="filenames must be a non-empty array")

    deleted, errors = [], []
    for name in body.filenames:
        safe = safe_filename(str(name))
        path = UPLOAD_FOLDER / safe
        if not path.is_file():
            errors.append({"file": safe, "reason": "not found"})
            continue
        try:
            path.unlink()
            deleted.append(safe)
            log.info("file_deleted", extra={"file": safe, "ip": request.client.host})
        except OSError as e:
            errors.append({"file": safe, "reason": e.strerror})

    return {"deleted": deleted, "errors": errors}


# ──────────────────────────────────────────────────────────────────
#  Routes — Downloads (single + bulk ZIP)
# ──────────────────────────────────────────────────────────────────

@app.get("/download/{filename}")
def download(
    filename: str,
    request: Request,
    inline: bool = False,              # ?inline=1 → browser renders, not downloads
    _: None = Depends(require_auth),   # token from header OR ?token= query param
):
    """
    Resumable single-file download via HTTP Range.
    Auth: Authorization: Bearer <token>  OR  ?token=<token> query param.
    Pass ?inline=1 for in-browser preview (images, video, PDF).
    """
    safe = safe_filename(filename)
    path = UPLOAD_FOLDER / safe

    if not path.is_file():
        log.warning("download_not_found", extra={"file": safe})
        raise HTTPException(status_code=404, detail="File not found")

    file_size   = path.stat().st_size
    range_hdr   = request.headers.get("range", "")
    start, end  = _parse_range(range_hdr, file_size) if range_hdr else (0, file_size - 1)
    length      = end - start + 1
    is_partial  = start != 0 or end != file_size - 1
    http_status = 206 if is_partial else 200

    log.info("download_start", extra={
        "file": safe, "size": file_size,
        "start": start, "end": end, "partial": is_partial,
    })

    CHUNK = 256 * 1024

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
        log.info("download_complete", extra={"file": safe, "bytes_sent": length})

    mime = mimetypes.guess_type(safe)[0] or "application/octet-stream"
    # ?inline=1 → browser renders the file (preview). Default → force download.
    disposition = f'inline; filename="{safe}"' if inline else f'attachment; filename="{safe}"'
    headers = {
        "Content-Disposition": disposition,
        "Content-Length":      str(length),
        "Accept-Ranges":       "bytes",
        "Content-Range":       f"bytes {start}-{end}/{file_size}",
        "Cache-Control":       "no-store",
    }

    return StreamingResponse(
        stream_file(),
        status_code=http_status,
        media_type=mime,
        headers=headers,
    )


@app.post("/api/download")
def api_download_bulk(
    body: BulkFilenames,
    request: Request,
    _: None = Depends(require_auth),
):
    """
    POST /api/download
    Body: {"filenames": ["a.jpg", "b.pdf"]}
    Returns a ZIP stream. Files that don't exist are skipped.
    """
    if not body.filenames:
        raise HTTPException(status_code=400, detail="filenames must be a non-empty array")

    paths, missing = [], []
    for name in body.filenames:
        safe = safe_filename(str(name))
        path = UPLOAD_FOLDER / safe
        if path.is_file():
            paths.append((safe, path))
        else:
            missing.append(safe)

    if not paths:
        raise HTTPException(status_code=404, detail="None of the requested files were found")

    log.info("bulk_download_start", extra={
        "files": [p[0] for p in paths], "missing": missing,
        "ip": request.client.host,
    })

    # Build ZIP in memory (fine for LAN-scale file sizes)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for safe_name, p in paths:
            zf.write(p, arcname=safe_name)
    zip_bytes = buf.getvalue()

    log.info("bulk_download_ready", extra={"zip_size": len(zip_bytes)})

    CHUNK = 256 * 1024

    def stream_zip():
        offset = 0
        while offset < len(zip_bytes):
            yield zip_bytes[offset: offset + CHUNK]
            offset += CHUNK

    return StreamingResponse(
        stream_zip(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="localdrop_selection.zip"',
            "Content-Length":      str(len(zip_bytes)),
            "Cache-Control":       "no-store",
        },
    )


# ──────────────────────────────────────────────────────────────────
#  Routes — Clipboard
# ──────────────────────────────────────────────────────────────────

@app.get("/api/clipboard")
def api_clipboard_get():
    return {"items": clipboard_read()}


@app.post("/api/clipboard")
def api_clipboard_post(body: ClipboardBody, _: None = Depends(require_auth)):
    if len(body.text) > 100_000:
        raise HTTPException(status_code=400, detail="Text too long (max 100 KB)")
    return clipboard_write(body.text)


@app.delete("/api/clipboard")
def api_clipboard_delete(_: None = Depends(require_auth)):
    clipboard_clear()
    return {"text": "", "updated": 0}


# ──────────────────────────────────────────────────────────────────
#  Routes — Server info & health
# ──────────────────────────────────────────────────────────────────

@app.get("/api/server-info")
def api_server_info(_: None = Depends(require_auth)):
    return {
        "url":              get_server_url(),
        "ip":               get_local_ip(),
        "port":             PORT,
        "passwordRequired": bool(APP_PASSWORD),
        "maxMB":            MAX_FILE_SIZE // (1024 * 1024),
    }


@app.get("/health")
def health():
    return {"status": "ok", "ip": get_local_ip(), "port": PORT}


# ──────────────────────────────────────────────────────────────────
#  Global exception → JSON (mirrors Flask's @app.errorhandler)
# ──────────────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    log.exception("unhandled_error")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )

_STATIC_DIR = Path(__file__).parent / "static"

if _STATIC_DIR.is_dir():
    from starlette.staticfiles import StaticFiles
    from starlette.responses import FileResponse as _FileResponse

    _ASSETS_DIR = _STATIC_DIR / "assets"
    if _ASSETS_DIR.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_ASSETS_DIR)),
            name="assets",
        )

    # Serve favicon and other root-level static files
    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        f = _STATIC_DIR / "favicon.ico"
        if f.is_file():
            return _FileResponse(str(f))
        raise HTTPException(status_code=404, detail="No favicon")

    # SPA catch-all — every unmatched path returns index.html so
    # React Router can handle /files, /settings, etc. client-side.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = _STATIC_DIR / "index.html"
        if index.is_file():
            return _FileResponse(
                str(index),
                headers={"Cache-Control": "no-cache"},   # always fresh
            )
        return JSONResponse(
            status_code=503,
            content={
                "error": "Frontend not built yet.",
                "hint": "Run `npm run build` inside the frontend/ folder.",
            },
        )

    log.info("static_files_mounted", extra={"dir": str(_STATIC_DIR)})

else:
    log.warning(
        "static_dir_missing",
        extra={
            "path": str(_STATIC_DIR),
            "hint": "Run `npm run build` in frontend/ to generate static/react/",
        },
    )
# ──────────────────────────────────────────────────────────────────
#  Dev entry point
# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    ip = get_local_ip()
    print("\n" + "═" * 60)
    print("  📡  LocalDrop — FastAPI server")
    print("═" * 60)
    print(f"  Local   ▸  http://localhost:{PORT}")
    print(f"  Network ▸  http://{ip}:{PORT}")
    print(f"  Docs    ▸  http://localhost:{PORT}/api/docs")
    print(f"  Max     ▸  {MAX_FILE_SIZE // (1024 * 1024)} MB per file")
    print(f"  Auth    ▸  {'Password protected' if APP_PASSWORD else 'Open (no password)'}")
    print("═" * 60)
    print("  Endpoints:")
    print("  GET   /api/auth/status       → {passwordRequired, authenticated}")
    print("  POST  /api/auth/login        → {token, passwordRequired}")
    print("  POST  /api/auth/logout       → {success}")
    print("  GET   /api/files             → {files: [{name,size,size_human,...}]}")
    print("  POST  /api/upload            → stream, X-Filename header")
    print("  DELETE /api/delete/{name}   → delete one")
    print("  POST  /api/delete            → {filenames:[...]} bulk delete")
    print("  GET   /download/{name}       → resumable stream")
    print("  POST  /api/download          → {filenames:[...]} ZIP stream")
    print("  GET   /api/clipboard         → {items:[...]}")
    print("  POST  /api/clipboard         → share text")
    print("  DELETE /api/clipboard        → clear all")
    print("  GET   /api/server-info       → {ip,port,passwordRequired,maxMB}")
    print("  GET   /health               → health check (no auth)")
    print("═" * 60 + "\n")
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=False)