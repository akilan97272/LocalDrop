import sys
from pathlib import Path

# ensure current directory is in path
sys.path.insert(0, str(Path(__file__).parent))

from app import app

application = app