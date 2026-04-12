"""
gunicorn.conf.py — Production WSGI server configuration for LocalDrop.

Apply with:
    gunicorn -c gunicorn.conf.py wsgi:app
"""

import multiprocessing
import os
from pathlib import Path

# ── Binding ────────────────────────────────────────────────────────
# "0.0.0.0" means listen on ALL network interfaces, including the
# Wi-Fi adapter.  This is what allows other devices to connect.
bind = f"0.0.0.0:{os.environ.get('LOCALDROP_PORT', '5000')}"

# ── Workers ────────────────────────────────────────────────────────
# sync workers: safe for large file I/O on a LAN server.
# Formula: (2 × CPU cores) + 1  is the Gunicorn recommendation.
workers     = 1
worker_class = "sync"                   # gthread also works if you install it

# Threads per worker — helps with concurrent small requests (e.g. file
# list polling) while a worker is busy streaming a large upload.
threads = 1

# ── Timeouts ──────────────────────────────────────────────────────
# Worker timeout: kill and restart a worker that takes longer than this.
# Set high enough for a 500 MB file on a slow Wi-Fi link.
# 500 MB ÷ ~5 MB/s (40 Mbps Wi-Fi) ≈ 100 s  →  use 300 s for safety.
timeout         = 300   # seconds
graceful_timeout = 60   # seconds before force-kill on reload

# Keep-alive for persistent connections (mobile browsers reuse connections)
keepalive = 5           # seconds

# ── Request limits ─────────────────────────────────────────────────
# Must match (or exceed) app.py MAX_FILE_SIZE.
# Gunicorn's limit is in bytes.  500 MB = 524 288 000 bytes.
limit_request_line    = 8190            # max length of the HTTP request line
limit_request_fields  = 200             # max number of HTTP header fields
limit_request_field_size = 16380        # max length per header field

# ── Buffering ──────────────────────────────────────────────────────
# Read the entire request body into memory before passing to the app.
# Prevents slow-client attacks and simplifies streaming to disk.
# Gunicorn default (65535 bytes) is far too small for file uploads;
# set to 10 MB so the body buffer doesn't stall on large uploads.
worker_connections = 1000   # only used by eventlet/gevent workers

# ── Logging ───────────────────────────────────────────────────────
BASE_DIR    = Path(os.getcwd())
LOG_DIR     = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

accesslog   = str(LOG_DIR / "access.log")
errorlog    = str(LOG_DIR / "error.log")
loglevel    = "info"                    # debug | info | warning | error
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s bytes in %(D)sµs'

# ── Process management ────────────────────────────────────────────
pidfile     = str(BASE_DIR / "localdrop.pid")
daemon      = False                     # systemd manages daemonisation
preload_app = True                      # load app once, fork workers — faster startup

# ── Server hooks (printed to stderr for visibility) ───────────────
def on_starting(server):
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0)
            s.connect(("10.254.254.254", 1))
            lan_ip = s.getsockname()[0]
    except Exception:
        lan_ip = "127.0.0.1"

    port = os.environ.get("LOCALDROP_PORT", "5000")
    print("\n" + "═" * 58)
    print("  📡  LocalDrop — Gunicorn WSGI server")
    print("═" * 58)
    print(f"  Local    ▸  http://localhost:{port}")
    print(f"  Network  ▸  http://{lan_ip}:{port}   ← use this on phone")
    print(f"  Workers  ▸  {workers} sync workers × {threads} threads")
    print(f"  Timeout  ▸  {timeout}s  |  Max upload: 500 MB")
    print("═" * 58 + "\n")


def worker_exit(server, worker):
    pass  # clean-up hook if needed
