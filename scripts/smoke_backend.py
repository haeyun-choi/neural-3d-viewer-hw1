#!/usr/bin/env python3
"""Start a real, short-lived Uvicorn process with a temporary SQLite database."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="hw1-startup-") as directory:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = {**os.environ, "DATABASE_PATH": str(Path(directory) / "smoke.sqlite3")}
        imported = subprocess.run(
            [sys.executable, "-c", "from app.main import app; assert app.title == 'Neural 3D Data Viewer'"],
            cwd=ROOT / "backend", env=env, check=True,
        )
        assert imported.returncode == 0
        assert not Path(env["DATABASE_PATH"]).exists(), "Import must not create a database"
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT / "backend", env=env,
        )
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Backend exited before startup")
                try:
                    with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                        assert json.load(response) == {"status": "ok", "database": "sqlite"}
                    with urlopen(f"http://127.0.0.1:{port}/api/scenes", timeout=1) as response:
                        assert json.load(response)[0]["id"] == "spectrum-garden"
                    assert Path(env["DATABASE_PATH"]).exists()
                    print("PASS: import without side effects, Uvicorn startup, HTTP health/scenes, SQLite creation")
                    break
                except URLError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Backend startup timed out")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
