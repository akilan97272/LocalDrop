#!/usr/bin/env bash
# ── defaults ──────────────────────────────────────────────────────
PORT=5000
PASSWORD=""
TOTAL_SIZE=500

# ── parse flags ───────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port|-p)      PORT="$2";      shift 2 ;;
        --password|-P)  PASSWORD="$2";  shift 2 ;;
        --size|-s)      TOTAL_SIZE="$2"; shift 2 ;;
        -3)             PORT="$2"; TOTAL_SIZE="$3"; PASSWORD="$4"; shift 4 ;;
        *) echo "❌ Unknown option: $1"; exit 1 ;;
    esac
done

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  📡 LocalDrop — starting on port $PORT"
echo ""

# ── dirs ──────────────────────────────────────────────────────────
mkdir -p "$DIR/uploads" "$DIR/logs"

# ── Python venv ───────────────────────────────────────────────────
if [ ! -d "$DIR/venv" ]; then
    echo "  [→] Creating virtualenv …"
    python3 -m venv "$DIR/venv" || {
        echo "  [✗] python3-venv missing. Run: sudo apt install python3-venv"
        exit 1
    }
    source "$DIR/venv/bin/activate"
    pip install -r "$DIR/requirements.txt" || {
        echo "  [✗] Failed to install dependencies from requirements.txt"
        exit 1
    }
else
    echo "  [→] Using existing virtualenv [path: $DIR/venv]"
    source "$DIR/venv/bin/activate"
    pip install -r "$DIR/requirements.txt" || {
        echo "  [✗] Failed to install dependencies from requirements.txt"
        exit 1
    }
fi  

PYTHON="$DIR/venv/bin/python3"
PIP="$DIR/venv/bin/pip"
GUNICORN="$DIR/venv/bin/gunicorn"

# ── Python deps ───────────────────────────────────────────────────
echo "  [→] Installing Python dependencies …"
# fastapi + uvicorn[standard] replaces flask/werkzeug.
# uvicorn[standard] includes uvloop + httptools for better performance.
"$PIP" install --quiet fastapi "uvicorn[standard]" gunicorn
echo "  [✓] Python dependencies ready"

# ── Frontend build ────────────────────────────────────────────────
FRONTEND_DIR="$DIR/LocalDrop-dev"   # adjust if your Vite project is elsewhere
STATIC_OUT="$DIR/static"

if [ -d "$FRONTEND_DIR" ]; then
    if [ ! -d "$STATIC_OUT" ] || [ "$FRONTEND_DIR/src" -nt "$STATIC_OUT/index.html" ] 2>/dev/null; then
        echo "  [→] Building React frontend …"
        cd "$FRONTEND_DIR"
        # Pass env vars so vite.config.js bakes the correct API URL
        LOCALDROP_PORT="$PORT" \
        LOCALDROP_API_URL="http://127.0.0.1:$PORT" \
        npm install && npm run build && echo "  [✓] Frontend built → $STATIC_OUT" || \
            echo "  [!] Frontend build failed — serving API only"
        cd "$DIR"
    else
        echo "  [✓] Frontend already built (static/react exists)"
    fi
else
    echo "  [!] No frontend/ directory found — skipping build"
fi

# ── secret key ────────────────────────────────────────────────────
SECRET_FILE="$DIR/.secret_key"
if [ ! -f "$SECRET_FILE" ]; then
    "$PYTHON" -c "import secrets; open('$SECRET_FILE','wb').write(secrets.token_bytes(32))"
    echo "  [✓] Secret key created"
fi

# # ── firewall (best-effort) ────────────────────────────────────────
# if command -v ufw >/dev/null 2>&1; then
#     sudo ufw allow "$PORT/tcp" >/dev/null 2>&1 && echo "  [✓] ufw: port $PORT open" || true
# fi

# ── LAN IP ────────────────────────────────────────────────────────
LAN_IP=$("$PYTHON" -c "
import socket
try:
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(0)
    s.connect(('10.254.254.254',1)); print(s.getsockname()[0])
except: print('127.0.0.1')
")

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  Local   →  http://localhost:$PORT       │"
echo "  │  Network →  http://$LAN_IP:$PORT   │"
echo "  │                                         │"
echo "  │  Open the Network URL on your phone     │"
echo "  │  Ctrl+C to stop                         │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── export env for FastAPI app ────────────────────────────────────
export LOCALDROP_PORT="$PORT"
export LOCALDROP_PASSWORD="$PASSWORD"
export LOCALDROP_MAX_MB="$TOTAL_SIZE"
export LOCALDROP_API_URL="http://127.0.0.1:$PORT"

# ── launch ────────────────────────────────────────────────────────
# worker_class is set in gunicorn_conf.py → uvicorn.workers.UvicornWorker
exec "$GUNICORN" \
    --bind         "0.0.0.0:$PORT" \
    --timeout      1800 \
    --keep-alive   10 \
    --access-logfile  "$DIR/logs/access.log" \
    --error-logfile   "$DIR/logs/error.log" \
    --log-level    info \
    --chdir        "$DIR" \
    -c             "$DIR/gunicorn_conf.py" \
    wsgi:app