"""
gunicorn.conf.py — Production WSGI configuration for LocalDrop.

Run:
    gunicorn -c gunicorn.conf.py wsgi:app
"""

import os
from pathlib import Path

# ── Binding ───────────────────────────────────────────────────────
bind = f"0.0.0.0:{os.environ.get('LOCALDROP_PORT', '5000')}"

# ── Workers ───────────────────────────────────────────────────────
# Minimum 2 workers so background requests (clipboard poll, file list
# refresh) are handled while a large upload occupies one worker.
# A single worker means polls queue up, the browser connection pool
# fills, and it can kill the upload.  2 is the safe minimum.
workers      = 2
worker_class = "sync"    # sync is correct for disk-bound file I/O
threads      = 1         # sync workers ignore threads anyway; keep 1

# ── Timeouts ──────────────────────────────────────────────────────
# Root cause of "network error" on large files:
# A 500 MB file over congested 2.4 GHz WiFi at ~1 MB/s real throughput
# takes ~500 seconds.  The old 300 s timeout killed the worker mid-
# transfer, which reset the TCP connection — exactly a "network error".
#
# 1800 s = 30 minutes.  Handles even very slow connections safely.
timeout          = 1800
graceful_timeout = 60
keepalive        = 10    # keep mobile browser connections alive longer

# ── Worker restart ────────────────────────────────────────────────
# Recycle workers every 500 requests to avoid slow memory growth.
# Do NOT set this too low — recycling during an upload kills it.
max_requests      = 500
max_requests_jitter = 50   # stagger restarts so both don't restart at once

# ── preload_app ───────────────────────────────────────────────────
# DISABLED.  With preload_app=True the master process imports app.py
# (writing .secret_key) before forking workers.  If the master runs as
# root and workers drop privileges, workers can't read the key file
# and all sessions break.  False = each worker imports independently,
# which is safe and correct.
preload_app = False

# ── Request line limits ───────────────────────────────────────────
limit_request_line       = 8190
limit_request_fields     = 200
limit_request_field_size = 16380

# ── Logging ───────────────────────────────────────────────────────
BASE_DIR  = Path(os.getcwd())
LOG_DIR   = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

accesslog  = str(LOG_DIR / "access.log")
errorlog   = str(LOG_DIR / "error.log")
loglevel   = "info"
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s bytes in %(D)sµs'

# ── PID file ──────────────────────────────────────────────────────
pidfile = str(BASE_DIR / "localdrop.pid")
daemon  = False    # let systemd / start.sh manage the process

# ── Startup banner ────────────────────────────────────────────────
def on_starting(server):
    import socket as _socket
    try:
        with _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM) as s:
            s.settimeout(0); s.connect(("10.254.254.254", 1))
            lan_ip = s.getsockname()[0]
    except Exception:
        lan_ip = "127.0.0.1"

    port    = os.environ.get("LOCALDROP_PORT", "5000")
    max_mb  = int(os.environ.get("LOCALDROP_MAX_MB", 500))
    print("\n" + "═" * 60)
    print("  📡  LocalDrop — Gunicorn WSGI server")
    print("═" * 60)
    print(f"  Local    ▸  http://localhost:{port}")
    print(f"  Network  ▸  http://{lan_ip}:{port} ")
    print(f"  Workers  ▸  {workers}  |  Timeout: {timeout}s")
    print("═" * 60 + "\n")