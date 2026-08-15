#!/usr/bin/env python3
"""Create a reproducible inventory for archived facility-description research."""

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--research-dir",
        default="data/research/facility-description-web-crawl-2026-08-09",
    )
    return parser.parse_args()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    args = parse_args()
    research_dir = Path(args.research_dir).resolve()
    output_path = research_dir / "archive-manifest.json"
    files = []
    for path in sorted(research_dir.rglob("*")):
        if not path.is_file() or path == output_path:
            continue
        relative_path = path.relative_to(research_dir).as_posix()
        files.append({
            "path": relative_path,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })

    top_level_counts = Counter(item["path"].split("/", 1)[0] for item in files)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "researchDirectory": research_dir.name,
        "fileCount": len(files),
        "totalBytes": sum(item["bytes"] for item in files),
        "topLevelCounts": dict(sorted(top_level_counts.items())),
        "hashAlgorithm": "SHA-256",
        "files": files,
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": str(output_path),
        "fileCount": payload["fileCount"],
        "totalBytes": payload["totalBytes"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
