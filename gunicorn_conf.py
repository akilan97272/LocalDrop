import os
from pathlib import Path

# ── Binding ───────────────────────────────────────────────────────
bind = f"0.0.0.0:{os.environ.get('LOCALDROP_PORT', '5000')}"

# ── Workers ───────────────────────────────────────────────────────
# UvicornWorker runs an asyncio event loop per worker process.
# Each worker handles many concurrent requests via async I/O —
# unlike sync workers which block per-request.
# 2 workers = plenty for a LAN file-sharing box.
workers      = 2
worker_class = "uvicorn.workers.UvicornWorker"   # ← THE critical fix

# threads is ignored by UvicornWorker (async handles concurrency).
# Leave it out to avoid confusion.

# ── Timeouts ──────────────────────────────────────────────────────
# 1800s = 30 minutes. Handles 500 MB over slow 2.4 GHz WiFi (~1 MB/s).
timeout          = 1800
graceful_timeout = 60
keepalive        = 10

# ── Worker restart ────────────────────────────────────────────────
max_requests        = 500
max_requests_jitter = 50

# ── preload_app ───────────────────────────────────────────────────
# Keep False — avoids permission issues with .secret_key file when
# master forks workers.
preload_app = False

# ── Request line limits ───────────────────────────────────────────
limit_request_line       = 8190
limit_request_fields     = 200
limit_request_field_size = 16380

# ── Logging ───────────────────────────────────────────────────────
BASE_DIR = Path(os.getcwd())
LOG_DIR  = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

accesslog         = str(LOG_DIR / "access.log")
errorlog          = str(LOG_DIR / "error.log")
loglevel          = "info"
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s bytes in %(D)sµs'

# ── PID file ──────────────────────────────────────────────────────
pidfile = str(BASE_DIR / "localdrop.pid")
daemon  = False

# ── Startup banner ────────────────────────────────────────────────
def on_starting(server):
    import socket as _socket
    try:
        with _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM) as s:
            s.settimeout(0)
            s.connect(("10.254.254.254", 1))
            lan_ip = s.getsockname()[0]
    except Exception:
        lan_ip = "127.0.0.1"

    port   = os.environ.get("LOCALDROP_PORT", "5000")
    max_mb = int(os.environ.get("LOCALDROP_MAX_MB", 500))
    pw     = os.environ.get("LOCALDROP_PASSWORD", "")
    print("\n" + "═" * 60)
    print("  📡  LocalDrop — Gunicorn + UvicornWorker (ASGI)")
    print("═" * 60)
    print(f"  Local    ▸  http://localhost:{port}")
    print(f"  Network  ▸  http://{lan_ip}:{port}")
    print(f"  Workers  ▸  {workers}  |  Timeout: {timeout}s")
    print(f"  Max      ▸  {max_mb} MB per file")
    print(f"  Auth     ▸  {'Password protected' if pw else 'Open (no password)'}")
    print("═" * 60 + "\n")