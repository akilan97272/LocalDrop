# 📡 LocalDrop — Local Network File Sharing

Drop a file → open URL on another device → download instantly.

A lightweight Flask + Gunicorn server that lets any device on your Wi-Fi
upload and download files through a browser — no apps, no setup.

## Features

- ⚡ Streaming uploads (no temp files, no RAM spikes)
- 📱 Works on any device with a browser
- 🔒 Optional password protection
- 🌐 Local network only (fast & private)

## Quick Start

```bash
# Install deps
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
chmod +x start.sh
```
## Examples

```bash
# Run on port 9000
./start.sh -p 9000

# Allow large uploads (2GB)
./start.sh -s 2000

# Secure with password
./start.sh -P mysecret

# Full setup
./start.sh -p 8080 -s 5000 -P mysecret

# Custom Flags
# -p -> Port
# -s -> Max file size per upload (in MB)
# -P -> Password
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

Flask's development server is not suitable for production and has limitations for large file uploads.
Gunicorn binds to `0.0.0.0` and handles concurrent uploads more reliably.

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
| Upload fails / stops midway | Increase `-s` value or ensure enough disk space |
| Sessions lost on restart | `.secret_key` file must exist and not be deleted |
