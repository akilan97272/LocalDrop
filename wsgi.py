import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app import app  # this is the FastAPI ASGI app object

# Gunicorn looks for `app` or `application` by convention.
# UvicornWorker accepts the ASGI callable directly.
application = app