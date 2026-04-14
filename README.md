# 📡 LocalDrop — Local Network File Sharing

A lightweight Flask + Gunicorn server that lets any device on your Wi-Fi
upload and download files through a browser — no apps, no setup.

## Quick Start

```bash
# Install deps
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
chmod +x start.sh

# Run
./start.sh                     # default port 5000 & no password
./start.sh 8080 mypassword     # custom port & password
```

## Files

| File | Purpose |
|------|---------|
| `app.py` | Flask app — routes, helpers, config |
| `wsgi.py` | WSGI entry point (`from app import app`) |
| `gunicorn.conf.py` | Workers, timeouts, binding, logging |
| `start.sh` | Startup script — venv, firewall, Gunicorn |
| `localdrop.service` | systemd unit for run-on-boot |

## Why Gunicorn?

Flask's dev server binds to `127.0.0.1` by default — other devices can't reach it.
Gunicorn binds to `0.0.0.0` and handles concurrent uploads properly.

## Firewall

```bash
sudo ufw allow 5000/tcp        # Ubuntu/Debian
sudo firewall-cmd --permanent --add-port=5000/tcp  # Fedora/RHEL

# Verify Gunicorn listens on ALL interfaces (not just localhost):
ss -tlnp | grep 5000
# Must show 0.0.0.0:5000
```

## Run on boot

```bash
# Edit localdrop.service — set User= and WorkingDirectory=
sudo cp localdrop.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now localdrop
```

## Config (app.py)

- `MAX_FILE_SIZE` — default 500 MB
- `LOCALDROP_PASSWORD` — set via environment variable to enable login
- `PORT` — default 5000, or set `LOCALDROP_PORT` env var

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Connection refused | `ss -tlnp \| grep 5000` must show `0.0.0.0` |
| Connection timeout | `sudo ufw allow 5000/tcp` |
| 413 error | Increase `MAX_FILE_SIZE` in `app.py` and `timeout` in `gunicorn.conf.py` |
| Sessions lost on restart | `.secret_key` file must exist and not be deleted |
