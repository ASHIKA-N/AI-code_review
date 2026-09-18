"""Run with the backend environment from the repository root."""
import json
from pathlib import Path

from app.main import create_app
from app.config import Settings

target = Path(__file__).resolve().parents[1] / "contracts" / "openapi.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(create_app(Settings(_env_file=None)).openapi(), indent=2) + "\n", encoding="utf-8")
