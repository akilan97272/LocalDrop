
import hashlib
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import secrets
import socket
import struct
import time
import unicodedata
import urllib.parse
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator


# ══════════════════════════════════════════════════════════════════════
#  Configuration
# ══════════════════════════════════════════════════════════════════════

UPLOAD_FOLDER   = Path(__file__).parent / "uploads"
CLIPBOARD_FILE  = Path(__file__).parent / ".clipboard"
_PASSWORD_FILE  = Path(__file__).parent / ".password_hash"   # bcrypt hash on disk
_CONFIG_FILE    = Path(__file__).parent / ".config"          # JSON: max_mb etc.

MAX_FILE_SIZE   = int(os.environ.get("LOCALDROP_MAX_MB", 500)) * 1024 * 1024
PORT            = int(os.environ.get("LOCALDROP_PORT",  5000))
TOKEN_TTL       = int(os.environ.get("LOCALDROP_TOKEN_TTL_HOURS", 24)) * 3600
ENCRYPT_AT_REST = os.environ.get("LOCALDROP_ENCRYPT", "0").strip() == "1"

# Rate-limit config
LOGIN_MAX_ATTEMPTS = 5          # per IP
LOGIN_WINDOW_SEC   = 60         # rolling window
LOCKOUT_SEC        = 15 * 60    # 15 minutes after too many failures

ALLOWED_EXTENSIONS = None       # None = all; set {"jpg","png"} to restrict

# ── Dangerous extension blocklist (always blocked regardless of ALLOWED_EXTENSIONS)
_BLOCKED_EXTENSIONS = {
    "exe", "bat", "cmd", "com", "msi", "ps1", "sh", "bash", "zsh",
    "vbs", "js", "jse", "wsf", "wsh", "scr", "pif", "reg", "inf",
    "dll", "so", "dylib", "app", "deb", "rpm",
}

# ── Magic-byte signatures for dangerous file types
_DANGEROUS_MAGIC = [
    b"MZ",           # Windows PE executable
    b"\x7fELF",      # Linux ELF
    b"\xfe\xed\xfa", # macOS Mach-O
    b"\xce\xfa\xed", # macOS Mach-O (32-bit)
]


# ══════════════════════════════════════════════════════════════════════
#  Secret key — persisted, used for HMAC + AES key derivation
# ══════════════════════════════════════════════════════════════════════

_KEY_FILE = Path(__file__).parent / ".secret_key"
if _KEY_FILE.exists():
    SECRET_KEY = _KEY_FILE.read_bytes()
else:
    SECRET_KEY = secrets.token_bytes(32)
    _KEY_FILE.write_bytes(SECRET_KEY)
    _KEY_FILE.chmod(0o600)

# AES-256 key derived from SECRET_KEY via HKDF (only used if ENCRYPT_AT_REST=1)
_AES_KEY = HKDF(
    algorithm=SHA256(), length=32, salt=None, info=b"localdrop-file-enc"
).derive(SECRET_KEY)

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════
#  Password management (bcrypt, runtime-settable)
# ══════════════════════════════════════════════════════════════════════

# ── Password state ───────────────────────────────────────────────────
#
# With Gunicorn multi-worker mode each worker is a separate OS process
# with its own memory. If one worker handles /api/auth/set-password it
# updates its in-memory _APP_PASSWORD_HASH — but the other workers
# still have the old value and will let everyone in.
#
# Fix: the source of truth is ALWAYS the .password_hash file on disk.
# We cache the hash in-process for CACHE_TTL_SEC (2 s) to avoid a
# stat()/read() on every single request, but never trust memory alone
# for the "is a password set?" question across more than 2 seconds.
#
# The env-var password is hashed ONCE at startup and written to the
# file so all workers share the same source of truth from the start.

_HASH_CACHE_TTL = 2.0   # seconds between re-reads of .password_hash

class _PasswordState:
    """
    Per-worker cache that re-reads .password_hash at most every TTL seconds.
    Thread-safe enough for asyncio (single-threaded per worker).
    """
    def __init__(self):
        self._hash: Optional[bytes] = None
        self._loaded_at: float = 0.0
        self._init()

    def _init(self):
        """
        On first load: if LOCALDROP_PASSWORD env var is set, hash it and
        write to disk so all workers share one file-based source of truth.
        Then read from disk.
        """
        env_pw = os.environ.get("LOCALDROP_PASSWORD") or ""
        if env_pw and not _PASSWORD_FILE.exists():
            h = bcrypt.hashpw(env_pw.encode(), bcrypt.gensalt(rounds=12))
            _PASSWORD_FILE.write_bytes(h)
            _PASSWORD_FILE.chmod(0o600)
        self._refresh()

    def _refresh(self):
        """Read hash from disk into this worker's memory cache."""
        try:
            if _PASSWORD_FILE.exists():
                h = _PASSWORD_FILE.read_bytes().strip()
                self._hash = h if h else None
            else:
                self._hash = None
        except OSError:
            pass   # keep stale value on transient read error
        self._loaded_at = time.monotonic()

    def _maybe_refresh(self):
        if time.monotonic() - self._loaded_at > _HASH_CACHE_TTL:
            self._refresh()

    def get_hash(self) -> Optional[bytes]:
        self._maybe_refresh()
        return self._hash

    def required(self) -> bool:
        return self.get_hash() is not None

    def verify(self, plain: str) -> bool:
        h = self.get_hash()
        if h is None:
            return True
        try:
            return bcrypt.checkpw(plain.encode(), h)
        except Exception:
            return False

    def set(self, new_password: str) -> None:
        """
        Hash and persist a new password (or remove it).
        Writes to disk first — other workers will pick it up within TTL.
        Then updates this worker's cache immediately.
        """
        if new_password:
            h = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(rounds=12))
            _PASSWORD_FILE.write_bytes(h)
            _PASSWORD_FILE.chmod(0o600)
            self._hash = h
        else:
            _PASSWORD_FILE.unlink(missing_ok=True)
            self._hash = None
        self._loaded_at = time.monotonic()


_pw = _PasswordState()

# Convenience shorthands used throughout the file
def _password_required() -> bool:       return _pw.required()
def _verify_password(plain: str) -> bool: return _pw.verify(plain)
def _set_password(new_password: str):   _pw.set(new_password)


# ══════════════════════════════════════════════════════════════════════
#  Logging — app + audit
# ══════════════════════════════════════════════════════════════════════

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
            "ts":    datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k not in self._SKIP:
                payload[k] = v
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def _make_logger(name: str, filename: str) -> logging.Logger:
    h = RotatingFileHandler(_LOG_DIR / filename, maxBytes=5_000_000, backupCount=5)
    h.setFormatter(_JsonFormatter())
    lg = logging.getLogger(name)
    lg.setLevel(logging.INFO)
    lg.addHandler(h)
    lg.addHandler(logging.StreamHandler())
    return lg

log   = _make_logger("localdrop", "app.log")
audit = _make_logger("localdrop.audit", "audit.log")


# ══════════════════════════════════════════════════════════════════════
#  HMAC-signed tokens
#
#  Format:  <payload_b64>.<signature_hex>
#  Payload: JSON { "jti": <uuid>, "iat": <unix_ts>, "exp": <unix_ts> }
#  Signature: HMAC-SHA256(SECRET_KEY, payload_b64)
#
#  Tokens are also stored in _VALID_TOKENS so logout invalidates them
#  before expiry. The signature prevents forgery without needing a DB.
# ══════════════════════════════════════════════════════════════════════

import base64 as _b64

# ── Token store — file-backed so all Gunicorn workers share state ─────
#
# Tokens are HMAC-signed (unforgeable) and carry their own expiry, so
# we don't need to store every issued token. We only need a revocation
# list for explicit logouts and password-change invalidations.
#
# Revocation list: .revoked_tokens  — one jti per line, pruned on read.
# All workers write to / read from the same file → shared state without
# needing Redis or a DB.

_REVOKED_FILE = Path(__file__).parent / ".revoked_tokens"
_REVOKED_CACHE_TTL = 2.0   # re-read file at most every 2 s

class _RevokedStore:
    def __init__(self):
        self._revoked: set[str] = set()
        self._loaded_at: float = 0.0

    def _refresh(self):
        now = time.time()
        try:
            if _REVOKED_FILE.exists():
                lines = _REVOKED_FILE.read_text().splitlines()
                # Each line: "jti:exp_unix_ts"
                live = set()
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        jti, exp_s = line.split(":", 1)
                        if float(exp_s) > now:   # keep only non-expired
                            live.add(jti)
                    except ValueError:
                        pass
                self._revoked = live
                # Rewrite pruned file
                if live:
                    pruned = "".join(
                        l for l in lines
                        if l.strip() and l.split(":")[0] in live
                    )
                    _REVOKED_FILE.write_text(pruned + "\n")
                else:
                    _REVOKED_FILE.unlink(missing_ok=True)
            else:
                self._revoked = set()
        except OSError:
            pass
        self._loaded_at = time.monotonic()

    def _maybe_refresh(self):
        if time.monotonic() - self._loaded_at > _REVOKED_CACHE_TTL:
            self._refresh()

    def is_revoked(self, jti: str) -> bool:
        self._maybe_refresh()
        return jti in self._revoked

    def revoke(self, jti: str, exp: float) -> None:
        """Add a jti to the revocation list on disk."""
        try:
            with open(_REVOKED_FILE, "a") as f:
                f.write(f"{jti}:{exp}\n")
        except OSError:
            pass
        self._revoked.add(jti)
        self._loaded_at = time.monotonic()

    def revoke_all(self) -> None:
        """Nuke the revocation file and write a sentinel that invalidates
        all tokens issued before now (used on password change)."""
        # We use a special entry with jti="*" and exp=now to mark a
        # global invalidation epoch. _verify_token checks this.
        try:
            _REVOKED_FILE.write_text(f"*:{time.time()}/n")
        except OSError:
            pass
        self._revoked = {"*"}
        self._loaded_at = time.monotonic()

    def global_revoke_epoch(self) -> float:
        """Returns the timestamp of the last revoke_all(), or 0."""
        self._maybe_refresh()
        for entry in (_REVOKED_FILE.read_text().splitlines()
                      if _REVOKED_FILE.exists() else []):
            entry = entry.strip()
            if entry.startswith("*:"):
                try:
                    return float(entry[2:])
                except ValueError:
                    pass
        return 0.0


_revoked = _RevokedStore()


def _issue_token() -> str:
    jti = uuid.uuid4().hex
    now = int(time.time())
    exp = now + TOKEN_TTL
    payload = _b64.urlsafe_b64encode(
        json.dumps({"jti": jti, "iat": now, "exp": exp}).encode()
    ).decode()
    sig = hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify_token(token: str) -> Optional[dict]:
    """
    Validates HMAC signature + expiry + revocation.
    Works across all Gunicorn workers because revocation is file-backed.
    """
    try:
        payload_b64, sig = token.rsplit(".", 1)
        # 1. Verify HMAC signature — forgery check
        expected = hmac.new(SECRET_KEY, payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        # 2. Decode payload
        payload = json.loads(_b64.urlsafe_b64decode(payload_b64 + "=="))
        # 3. Check expiry
        if time.time() > payload["exp"]:
            return None
        # 4. Check individual revocation (logout)
        if _revoked.is_revoked(payload["jti"]):
            return None
        # 5. Check global revocation epoch (password change)
        #    Token must have been issued AFTER the last revoke_all()
        epoch = _revoked.global_revoke_epoch()
        if epoch and payload["iat"] < epoch:
            return None
        return payload
    except Exception:
        return None


def _revoke_token(token: str) -> None:
    """Revoke a single token (logout)."""
    try:
        payload_b64, _ = token.rsplit(".", 1)
        payload = json.loads(_b64.urlsafe_b64decode(payload_b64 + "=="))
        _revoked.revoke(payload["jti"], payload["exp"])
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════
#  Rate limiter — in-memory sliding window per IP
# ══════════════════════════════════════════════════════════════════════

# ip → list of attempt timestamps
_login_attempts: dict[str, list[float]] = defaultdict(list)
# ip → lockout_until timestamp
_lockouts: dict[str, float] = {}


def _check_rate_limit(ip: str) -> None:
    """Raises 429 if IP is locked out or over attempt threshold."""
    now = time.time()

    # Check lockout
    if ip in _lockouts:
        if now < _lockouts[ip]:
            remaining = int(_lockouts[ip] - now)
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts. Try again in {remaining}s.",
                headers={"Retry-After": str(remaining)},
            )
        else:
            del _lockouts[ip]
            _login_attempts.pop(ip, None)

    # Sliding window: keep only attempts within window
    window_start = now - LOGIN_WINDOW_SEC
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > window_start]

    if len(_login_attempts[ip]) >= LOGIN_MAX_ATTEMPTS:
        _lockouts[ip] = now + LOCKOUT_SEC
        audit.warning("login_lockout", extra={"ip": ip, "lockout_until": _lockouts[ip]})
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Locked out for {LOCKOUT_SEC // 60} minutes.",
            headers={"Retry-After": str(LOCKOUT_SEC)},
        )


def _record_failure(ip: str) -> None:
    _login_attempts[ip].append(time.time())


def _clear_attempts(ip: str) -> None:
    _login_attempts.pop(ip, None)
    _lockouts.pop(ip, None)


# ══════════════════════════════════════════════════════════════════════
#  File encryption/decryption (AES-256-GCM)
#  Only active when LOCALDROP_ENCRYPT=1
#
#  Encrypted file format on disk:
#    [4 bytes: magic "LDENC"] [12 bytes: nonce] [ciphertext+16-byte tag]
# ══════════════════════════════════════════════════════════════════════

_ENC_MAGIC = b"LDNC"


def _encrypt_file(src: Path, dst: Path) -> None:
    nonce = secrets.token_bytes(12)
    aes   = AESGCM(_AES_KEY)
    plain = src.read_bytes()
    ct    = aes.encrypt(nonce, plain, None)
    dst.write_bytes(_ENC_MAGIC + nonce + ct)


def _decrypt_stream(path: Path):
    """Generator that decrypts an encrypted file and yields plaintext chunks."""
    raw = path.read_bytes()
    if raw[:4] != _ENC_MAGIC:
        # Not encrypted — serve raw (handles files uploaded before ENCRYPT was set)
        yield raw
        return
    nonce = raw[4:16]
    ct    = raw[16:]
    aes   = AESGCM(_AES_KEY)
    plain = aes.decrypt(nonce, ct, None)
    CHUNK = 256 * 1024
    for i in range(0, len(plain), CHUNK):
        yield plain[i:i + CHUNK]


# ══════════════════════════════════════════════════════════════════════
#  Helpers
# ══════════════════════════════════════════════════════════════════════

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
    Secure filename — strips traversal sequences, normalises Unicode,
    then jails the result inside UPLOAD_FOLDER.
    """
    # 1. Normalise unicode
    name = unicodedata.normalize("NFKD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    # 2. Strip path separators and null bytes
    name = name.replace("\x00", "").replace("/", "_").replace("\\", "_")
    # 3. Allow only safe characters
    name = re.sub(r"[^\w.\- ]", "_", name).strip()
    name = name.strip(". ") or "upload"
    # 4. Jail check — resolve must stay inside UPLOAD_FOLDER
    resolved = (UPLOAD_FOLDER / name).resolve()
    if not str(resolved).startswith(str(UPLOAD_FOLDER.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


def _check_magic_bytes(data: bytes, filename: str) -> None:
    """Block files whose magic bytes indicate an executable, regardless of extension."""
    for magic in _DANGEROUS_MAGIC:
        if data[:len(magic)] == magic:
            raise HTTPException(
                status_code=400,
                detail=f"File rejected: binary executable content detected in '{filename}'",
            )


def allowed_file(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in _BLOCKED_EXTENSIONS:
        return False
    if ALLOWED_EXTENSIONS is not None:
        return ext in ALLOWED_EXTENSIONS
    return True


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
        if   mime.startswith("image"):                                      kind = "image"
        elif mime.startswith("video"):                                      kind = "video"
        elif mime.startswith("audio"):                                      kind = "audio"
        elif "pdf" in mime:                                                 kind = "pdf"
        elif any(x in mime for x in ("zip", "tar", "gzip", "rar", "7z")): kind = "archive"
        elif mime.startswith("text"):                                       kind = "text"
    return {
        "name":       path.name,
        "size":       stat.st_size,
        "size_human": _human_size(stat.st_size),
        "uploaded":   datetime.fromtimestamp(stat.st_mtime).strftime("%d %b %Y, %H:%M"),
        "timestamp":  stat.st_mtime,
        "kind":       kind,
        "mime":       mime or "application/octet-stream",
        "encrypted":  ENCRYPT_AT_REST,
    }


def list_files() -> list:
    return sorted(
        [file_info(f) for f in UPLOAD_FOLDER.iterdir() if f.is_file()],
        key=lambda x: x["timestamp"],
        reverse=True,
    )


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    match = re.match(r"bytes=(\d*)-(\d*)", range_header)
    if not match:
        return 0, file_size - 1
    s, e = match.group(1), match.group(2)
    start = int(s) if s else 0
    end   = int(e) if e else file_size - 1
    start = max(0, min(start, file_size - 1))
    end   = max(start, min(end, file_size - 1))
    return start, end


# ══════════════════════════════════════════════════════════════════════
#  Clipboard
# ══════════════════════════════════════════════════════════════════════

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


# ══════════════════════════════════════════════════════════════════════
#  Auth dependency
# ══════════════════════════════════════════════════════════════════════

def _extract_token(authorization: str = Header(default="")) -> Optional[str]:
    if authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return None


def require_auth(authorization: str = Header(default="")) -> None:
    if not _password_required():
        return
    token = _extract_token(authorization)
    if not token or not _verify_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized — please login first",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ══════════════════════════════════════════════════════════════════════
#  Pydantic bodies
# ══════════════════════════════════════════════════════════════════════

class LoginBody(BaseModel):
    password: str = ""

class SetPasswordBody(BaseModel):
    current_password: str = ""
    new_password: str = ""

    @field_validator("new_password")
    @classmethod
    def validate_new_pw(cls, v: str) -> str:
        if v and len(v) < 4:
            raise ValueError("Password must be at least 4 characters")
        return v

class BulkFilenames(BaseModel):
    filenames: list[str]

class ClipboardBody(BaseModel):
    text: str


# ══════════════════════════════════════════════════════════════════════
#  FastAPI app
# ══════════════════════════════════════════════════════════════════════

app = FastAPI(title="LocalDrop", version="3.0.0", docs_url="/api/docs")

# ── Middleware order matters in FastAPI/Starlette ─────────────────────
# Middleware is applied in REVERSE order of registration:
# last added = outermost = runs first on request, last on response.
#
# Correct order (outermost → innermost):
#   CORS  →  SecurityHeaders  →  route handler
#
# So we add SecurityHeaders first, then CORS — making CORS outermost.
# This ensures CORS headers are present on EVERY response including
# error responses from inner middleware, which fixes browser blocks.

# ── Security headers (inner middleware — added first) ─────────────────
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["X-Frame-Options"]         = "DENY"
        response.headers["X-XSS-Protection"]        = "1; mode=block"
        response.headers["Referrer-Policy"]         = "no-referrer"
        response.headers["Permissions-Policy"]      = "camera=(), microphone=(), geolocation=()"
        # Build connect-src to allow same-origin under any hostname the
        # browser might use (localhost, 127.0.0.1, or the LAN IP).
        # We read the port from env so the CSP stays accurate.
        _port = os.environ.get("LOCALDROP_PORT", "5000")
        _self_origins = (
            f"http://localhost:{_port} "
            f"http://127.0.0.1:{_port} "
            f"http://0.0.0.0:{_port}"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            f"img-src 'self' data: blob: https://api.qrserver.com; "
            f"connect-src 'self' {_self_origins}; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none';"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── CORS (outer middleware — added last = runs first) ─────────────────
# Must be outermost so CORS headers appear on ALL responses — including
# 4xx/5xx from inner middleware or route handlers. Without this, the
# browser sees a CORS error instead of the real error.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition", "Content-Length", "Content-Range",
        "X-Checksum-SHA256",
    ],
    max_age=3600,
)


# ══════════════════════════════════════════════════════════════════════
#  Routes — Auth
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/auth/status")
def api_auth_status(authorization: str = Header(default="")):
    # If no password is set, always return authenticated:true.
    # The frontend uses this to skip the login screen entirely.
    # Don't require or validate a token in this case — the client
    # may not have one yet (first load after npm run build).
    if not _password_required():
        return {"passwordRequired": False, "authenticated": True}

    token   = _extract_token(authorization)
    payload = _verify_token(token) if token else None
    return {
        "passwordRequired": True,
        "authenticated":    payload is not None,
    }


@app.post("/api/auth/login")
def api_login(body: LoginBody, request: Request):
    ip = request.client.host

    if not _password_required():
        token = _issue_token()
        audit.info("login_open", extra={"ip": ip})
        return {"token": token, "passwordRequired": False}

    # Rate-limit check BEFORE verifying password
    _check_rate_limit(ip)

    if _verify_password(body.password):
        _clear_attempts(ip)
        token = _issue_token()
        audit.info("login_success", extra={"ip": ip})
        return {"token": token, "passwordRequired": True}

    _record_failure(ip)
    remaining = LOGIN_MAX_ATTEMPTS - len(_login_attempts[ip])
    audit.warning("login_failure", extra={"ip": ip, "attempts_remaining": max(0, remaining)})
    raise HTTPException(
        status_code=401,
        detail=f"Incorrect password. {max(0, remaining)} attempt(s) remaining.",
    )


@app.post("/api/auth/logout")
def api_logout(authorization: str = Header(default="")):
    token = _extract_token(authorization)
    if token:
        _revoke_token(token)
    return {"success": True}


@app.post("/api/auth/set-password")
def api_set_password(
    body: SetPasswordBody,
    request: Request,
    authorization: str = Header(default=""),
):
    """
    Set or change the server password — no restart required.

    Rules:
    - If a password is currently set → current_password must be correct
    - If no password is set → no current_password needed (open server)
    - new_password = "" → removes password (open access)
    - new_password set  → sets new password, invalidates ALL existing tokens

    POST /api/auth/set-password
    { "current_password": "old", "new_password": "newpass" }
    """
    ip = request.client.host

    # Verify current password if one is set
    if _password_required():
        token = _extract_token(authorization)
        if not (token and _verify_token(token)):
            raise HTTPException(status_code=401, detail="Must be logged in to change password")
        if not _verify_password(body.current_password):
            _record_failure(ip)
            audit.warning("set_password_wrong_current", extra={"ip": ip})
            raise HTTPException(status_code=403, detail="Current password is incorrect")

    # Apply new password
    _set_password(body.new_password)

    # Invalidate ALL tokens across ALL workers — everyone must re-login.
    # revoke_all() writes a global epoch to disk; all workers read it.
    _revoked.revoke_all()

    action = "password_set" if body.new_password else "password_removed"
    audit.info(action, extra={"ip": ip})

    return {
        "success": True,
        "passwordRequired": _password_required(),
        "message": "Password updated. All sessions have been invalidated." if body.new_password
                   else "Password removed. Server is now open.",
    }


@app.get("/api/auth/lockout-status")
def api_lockout_status(request: Request):
    """Returns remaining attempts and lockout info for the calling IP."""
    ip  = request.client.host
    now = time.time()

    if ip in _lockouts and now < _lockouts[ip]:
        return {
            "locked":    True,
            "retryAfter": int(_lockouts[ip] - now),
            "attemptsRemaining": 0,
        }

    window_start = now - LOGIN_WINDOW_SEC
    recent = [t for t in _login_attempts.get(ip, []) if t > window_start]
    return {
        "locked":    False,
        "retryAfter": 0,
        "attemptsRemaining": max(0, LOGIN_MAX_ATTEMPTS - len(recent)),
    }


# ══════════════════════════════════════════════════════════════════════
#  Routes — Files
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/files")
def api_files(_: None = Depends(require_auth)):
    return {"files": list_files()}


@app.post("/api/upload")
async def api_upload(
    request: Request,
    x_filename: str = Header(default="upload"),
    _: None = Depends(require_auth),
):
    """
    Streaming binary upload.
    Headers: Content-Type: application/octet-stream, X-Filename: <url-encoded name>

    Security:
    - Extension blocklist enforced before writing
    - First chunk scanned for dangerous magic bytes
    - SHA-256 computed during streaming (zero extra memory)
    - File size enforced during streaming (never written past limit)
    - If LOCALDROP_ENCRYPT=1 → file encrypted AES-256-GCM at rest
    """
    try:
        filename = urllib.parse.unquote(x_filename, encoding="utf-8")
    except Exception:
        filename = x_filename

    filename = filename.strip() or "upload"

    if not allowed_file(filename):
        raise HTTPException(status_code=400, detail=f"'{filename}': file type not allowed")

    fname   = unique_filename(filename)
    dest    = UPLOAD_FOLDER / fname
    written = 0
    sha256  = hashlib.sha256()
    first_chunk = True
    CHUNK   = 256 * 1024

    try:
        with open(dest, "wb") as out:
            async for chunk in request.stream():
                # Check magic bytes on first chunk
                if first_chunk:
                    _check_magic_bytes(chunk, filename)
                    first_chunk = False

                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {MAX_FILE_SIZE // (1024*1024)} MB limit",
                    )
                sha256.update(chunk)
                out.write(chunk)
    except HTTPException:
        raise
    except OSError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Disk write failed: {e.strerror}")

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Received empty file")

    checksum = sha256.hexdigest()

    # Encrypt in place if enabled
    if ENCRYPT_AT_REST:
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        dest.rename(tmp)
        try:
            _encrypt_file(tmp, dest)
        finally:
            tmp.unlink(missing_ok=True)

    audit.info("file_uploaded", extra={
        "file": fname, "size": written,
        "sha256": checksum, "encrypted": ENCRYPT_AT_REST,
        "ip": request.client.host,
    })

    info = file_info(dest)
    info["sha256"] = checksum
    return {"uploaded": [info], "warnings": []}


@app.delete("/api/delete/{filename}")
def api_delete(filename: str, request: Request, _: None = Depends(require_auth)):
    safe = safe_filename(filename)
    path = UPLOAD_FOLDER / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    audit.info("file_deleted", extra={"file": safe, "ip": request.client.host})
    return {"deleted": safe}


@app.post("/api/delete")
def api_delete_bulk(body: BulkFilenames, request: Request, _: None = Depends(require_auth)):
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
            audit.info("file_deleted", extra={"file": safe, "ip": request.client.host})
        except OSError as e:
            errors.append({"file": safe, "reason": e.strerror})

    return {"deleted": deleted, "errors": errors}


# ══════════════════════════════════════════════════════════════════════
#  Routes — Downloads
# ══════════════════════════════════════════════════════════════════════

@app.get("/download/{filename}")
def download(
    filename: str,
    request: Request,
    token: Optional[str] = None,
    authorization: str = Header(default=""),
    _: None = Depends(require_auth),
):
    safe = safe_filename(filename)
    path = UPLOAD_FOLDER / safe

    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Decrypt or stream raw
    if ENCRYPT_AT_REST:
        # Decrypt fully to get size for headers, then stream
        raw = b"".join(_decrypt_stream(path))
        file_size = len(raw)
        range_hdr = request.headers.get("range", "")
        start, end = _parse_range(range_hdr, file_size) if range_hdr else (0, file_size - 1)
        length = end - start + 1
        checksum = hashlib.sha256(raw).hexdigest()

        def stream_dec():
            yield raw[start:start + length]

        mime = mimetypes.guess_type(safe)[0] or "application/octet-stream"
        audit.info("file_downloaded", extra={"file": safe, "ip": request.client.host})
        return StreamingResponse(
            stream_dec(),
            status_code=206 if (start or end != file_size - 1) else 200,
            media_type=mime,
            headers={
                "Content-Disposition":  f'attachment; filename="{safe}"',
                "Content-Length":       str(length),
                "Accept-Ranges":        "bytes",
                "Content-Range":        f"bytes {start}-{end}/{file_size}",
                "Cache-Control":        "no-store",
                "X-Checksum-SHA256":    checksum,
            },
        )

    # Plain (no encryption)
    file_size  = path.stat().st_size
    range_hdr  = request.headers.get("range", "")
    start, end = _parse_range(range_hdr, file_size) if range_hdr else (0, file_size - 1)
    length     = end - start + 1
    CHUNK      = 256 * 1024

    sha = hashlib.sha256()

    def stream_file():
        remaining = length
        with open(path, "rb") as fh:
            fh.seek(start)
            while remaining > 0:
                data = fh.read(min(CHUNK, remaining))
                if not data:
                    break
                sha.update(data)
                remaining -= len(data)
                yield data
        audit.info("file_downloaded", extra={"file": safe, "ip": request.client.host})

    mime = mimetypes.guess_type(safe)[0] or "application/octet-stream"
    return StreamingResponse(
        stream_file(),
        status_code=206 if (start or end != file_size - 1) else 200,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{safe}"',
            "Content-Length":      str(length),
            "Accept-Ranges":       "bytes",
            "Content-Range":       f"bytes {start}-{end}/{file_size}",
            "Cache-Control":       "no-store",
        },
    )


@app.post("/api/download")
def api_download_bulk(body: BulkFilenames, request: Request, _: None = Depends(require_auth)):
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

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for safe_name, p in paths:
            if ENCRYPT_AT_REST:
                data = b"".join(_decrypt_stream(p))
                zf.writestr(safe_name, data)
            else:
                zf.write(p, arcname=safe_name)

    zip_bytes = buf.getvalue()
    audit.info("bulk_download", extra={
        "files": [p[0] for p in paths], "ip": request.client.host
    })

    CHUNK = 256 * 1024
    def stream_zip():
        for i in range(0, len(zip_bytes), CHUNK):
            yield zip_bytes[i:i + CHUNK]

    return StreamingResponse(
        stream_zip(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="localdrop_selection.zip"',
            "Content-Length":      str(len(zip_bytes)),
            "Cache-Control":       "no-store",
        },
    )


# ══════════════════════════════════════════════════════════════════════
#  Routes — Clipboard
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/clipboard")
def api_clipboard_get(_: None = Depends(require_auth)):
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


# ══════════════════════════════════════════════════════════════════════
#  Routes — Server info & health
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/server-info")
def api_server_info(_: None = Depends(require_auth)):
    return {
        "url":              get_server_url(),
        "ip":               get_local_ip(),
        "port":             PORT,
        "passwordRequired": _password_required(),
        "maxMB":            MAX_FILE_SIZE // (1024 * 1024),
        "encrypted":        ENCRYPT_AT_REST,
        "tokenTTLHours":    TOKEN_TTL // 3600,
    }


@app.get("/health")
def health():
    return {"status": "ok", "ip": get_local_ip(), "port": PORT}


# ══════════════════════════════════════════════════════════════════════
#  Exception handlers
# ══════════════════════════════════════════════════════════════════════

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    log.exception("unhandled_error")
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


# ══════════════════════════════════════════════════════════════════════
#  Static files (SPA)
# ══════════════════════════════════════════════════════════════════════

_STATIC_DIR = Path(__file__).parent / "static" / "react"

if _STATIC_DIR.is_dir():
    from starlette.staticfiles import StaticFiles
    from starlette.responses import FileResponse as _FileResponse

    _ASSETS_DIR = _STATIC_DIR / "assets"
    if _ASSETS_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_ASSETS_DIR)), name="assets")

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        f = _STATIC_DIR / "favicon.ico"
        if f.is_file():
            return _FileResponse(str(f))
        raise HTTPException(status_code=404, detail="No favicon")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = _STATIC_DIR / "index.html"
        if index.is_file():
            return _FileResponse(str(index), headers={"Cache-Control": "no-cache"})
        return JSONResponse(status_code=503, content={
            "error": "Frontend not built.",
            "hint":  "Run `npm run build` inside the frontend/ folder.",
        })


# ══════════════════════════════════════════════════════════════════════
#  Dev entry point
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    ip = get_local_ip()
    print("\n" + "═" * 62)
    print("  📡  LocalDrop — Secured FastAPI server")
    print("═" * 62)
    print(f"  Local    ▸  http://localhost:{PORT}")
    print(f"  Network  ▸  http://{ip}:{PORT}")
    print(f"  Docs     ▸  http://localhost:{PORT}/api/docs")
    print(f"  Auth     ▸  {'Password protected (bcrypt)' if _password_required() else 'Open (no password)'}")
    print(f"  Encrypt  ▸  {'AES-256-GCM at rest ✓' if ENCRYPT_AT_REST else 'Off (set LOCALDROP_ENCRYPT=1)'}")
    print(f"  Tokens   ▸  HMAC-SHA256 signed, {TOKEN_TTL//3600}h TTL")
    print(f"  Rate limit ▸  {LOGIN_MAX_ATTEMPTS} attempts / {LOGIN_WINDOW_SEC}s → {LOCKOUT_SEC//60}m lockout")
    print("═" * 62 + "\n")
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=False)