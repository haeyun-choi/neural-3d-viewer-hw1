#!/usr/bin/env python3
"""Export only reviewed public files, without Git history or runtime artifacts."""

import argparse
import hashlib
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST = ROOT / "scripts" / "public-export-files.txt"
FORBIDDEN_NAMES = {"AGENTS.md", "TASK_BRIEF.md", "IMPLEMENTATION_PLAN.md", "SESSION_STATE.md"}
FORBIDDEN_PARTS = {".git", "node_modules", "dist", ".venv", "__pycache__", ".pytest_cache", "test-results", "playwright-report", "artifacts", "logs", "screenshots"}
MAX_TEXT_BYTES = 1_000_000
# Reviewed exceptions to the small-text-file rule, pinned byte-for-byte. These
# are binary third-party point clouds, so a UTF-8/secret regex scan does not
# apply to them; instead the SHA-256 below must match exactly or the export
# fails. No other file may exceed MAX_TEXT_BYTES, and nothing is copied that is
# not also in the allowlist.
LARGE_PUBLIC_FILES = {
    "sample-data/EaglePointCloud.ply": "468e41b3679f775b98fe8cc79132cb99e8d6dfc4dcc1bb684e571a90e326e478",
    "sample-data/fragment.ply": "96203542a5659c1efd2bcfe8a2dd7d3ffc9b88cf24680b4703515f6b21f67d99",
}
PATTERNS = {
    "user-specific filesystem path": r"/(?:home|scratch)/[A-Za-z0-9._-]+|/sfs/(?:gpfs|weka)/|[A-Z]:\\Users\\[A-Za-z0-9._-]+",
    "environment-specific path": r"\.conda[/\\]|/(?:opt|apps)/[^\s\"']*(?:conda|miniforge)",
    "internal hostname": r"\budc-[a-z0-9-]+\b",
    "email address": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "access token": r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})\b",
    "embedded credential": r"(?i)(?:password|api_key|access_token|secret)\s*[:=]\s*[\"'][^\"'\s]{8,}[\"']",
}


def public_files():
    paths = [line.strip() for line in ALLOWLIST.read_text().splitlines() if line.strip() and not line.startswith("#")]
    if len(paths) != len(set(paths)):
        raise ValueError("Duplicate public allowlist entries")
    for item in paths:
        path = Path(item)
        if path.is_absolute() or ".." in path.parts or path.name in FORBIDDEN_NAMES or set(path.parts) & FORBIDDEN_PARTS:
            raise ValueError(f"Disallowed export entry: {item}")
        if path.suffix in {".db", ".sqlite", ".sqlite3", ".log", ".png", ".jpg", ".pyc"}:
            raise ValueError(f"Runtime/binary artifact in allowlist: {item}")
        if path.name.startswith(".env") and path.name != ".env.example":
            raise ValueError(f"Environment file in allowlist: {item}")
    # A checksum pin must never outlive its allowlist entry.
    if not set(LARGE_PUBLIC_FILES) <= set(paths):
        raise ValueError("Checksum-pinned file is not in the public allowlist")
    return paths


def scan(root: Path, paths: list[str]):
    total = 0
    for item in paths:
        path = root / item
        if not path.is_file() or any(parent.is_symlink() for parent in [path, *path.parents] if parent != root and root in parent.parents):
            raise ValueError(f"Missing or symlinked public file: {item}")
        data = path.read_bytes()
        pinned = LARGE_PUBLIC_FILES.get(item)
        if pinned is not None:
            if hashlib.sha256(data).hexdigest() != pinned:
                raise ValueError(f"Checksum mismatch for pinned public file: {item}")
            total += len(data)
            continue
        if len(data) > MAX_TEXT_BYTES:
            raise ValueError(f"Unexpected large public file: {item}")
        text = data.decode("utf-8")
        for name, pattern in PATTERNS.items():
            if re.search(pattern, text):
                # Never print a possible secret or its surrounding source text.
                raise ValueError(f"Public scan found {name} in {item}")
        total += len(data)
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Validate and list the allowlist without copying")
    group.add_argument("--output", type=Path, help="New directory outside this repository; never overwritten")
    group.add_argument("--scan", type=Path, help="Verify an existing export has only allowed, sanitized files")
    args = parser.parse_args()
    paths = public_files()
    if args.scan:
        root = args.scan.resolve()
        found = {str(path.relative_to(root)) for path in root.rglob("*") if path.is_file() or path.is_symlink()}
        if found != set(paths):
            raise ValueError("Export has missing or unexpected files")
    else:
        root = ROOT
    total = scan(root, paths)
    if args.output:
        destination = args.output.resolve()
        if destination == ROOT or ROOT in destination.parents or destination.exists():
            raise ValueError("Output must be a new directory outside the source repository")
        destination.mkdir(parents=True)
        for item in paths:
            target = destination / item
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / item, target)
        scan(destination, paths)
    if args.dry_run:
        for item in paths:
            print(f"{hashlib.sha256((ROOT / item).read_bytes()).hexdigest()}  {item}")
    print(f"PASS: {len(paths)} allowlisted files, {total:,} bytes; secret/path scan clean; no Git history or runtime files")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, UnicodeError) as error:
        raise SystemExit(str(error)) from None
