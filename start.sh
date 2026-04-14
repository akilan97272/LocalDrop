#!/usr/bin/env bash
# LocalDrop — start server
# Usage:  ./start.sh [port] [password]  default port: 5000 & default password: None

PORT="${1:-5000}"
PASSWORD="${2:-}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  📡 LocalDrop — starting on port $PORT"
echo ""

# ── dirs ──────────────────────────────────────────────────────────
mkdir -p "$DIR/uploads" "$DIR/logs"

# ── venv ──────────────────────────────────────────────────────────
if [ ! -d "$DIR/venv" ]; then
    echo "  [→] Creating virtualenv …"
    python3 -m venv "$DIR/venv" || { echo "  [✗] python3-venv missing. Run: sudo apt install python3-venv"; exit 1; }
fi

PYTHON="$DIR/venv/bin/python3"
PIP="$DIR/venv/bin/pip"
GUNICORN="$DIR/venv/bin/gunicorn"

# ── deps ──────────────────────────────────────────────────────────
echo "  [→] Installing dependencies …"
"$PIP" install --quiet flask werkzeug gunicorn
echo "  [✓] Dependencies ready"

# ── secret key (created once, owned by current user) ──────────────
SECRET_FILE="$DIR/.secret_key"
if [ ! -f "$SECRET_FILE" ]; then
    "$PYTHON" -c "import secrets; open('$SECRET_FILE','wb').write(secrets.token_bytes(32))"
    echo "  [✓] Secret key created"
fi

# ── firewall (best-effort, never fatal) ───────────────────────────
if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow "$PORT/tcp" >/dev/null 2>&1 && echo "  [✓] ufw: port $PORT open" || true
fi

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
echo "  │  Network →  http://$LAN_IP:$PORT    │"
echo "  │                                         │"
echo "  │  Open the Network URL on your phone     │"
echo "  │  Ctrl+C to stop                         │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── launch ────────────────────────────────────────────────────────
export LOCALDROP_PORT="$PORT"
export LOCALDROP_PASSWORD="$PASSWORD"

exec "$GUNICORN" \
    --bind        "0.0.0.0:$PORT" \
    --workers     2 \
    --worker-class sync \
    --threads     1 \
    --timeout     300 \
    --keep-alive  5 \
    --max-requests 1000 \
    --access-logfile  "$DIR/logs/access.log" \
    --error-logfile   "$DIR/logs/error.log" \
    --log-level   info \
    --chdir       "$DIR" \
    -c gunicorn.conf.py wsgi:app