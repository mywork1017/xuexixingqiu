#!/usr/bin/env python3
"""Apply hand-curated facility descriptions to the SQLite master database."""

import argparse
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path


TRAILING_PUNCTUATION = re.compile(r"[。！？；;，,.!?]$")
GENERIC_ACTIVITY = re.compile(r"想读书|想学习|想自习|想阅读|适合读书|适合学习|适合自习|适合阅读")
CHANNEL_NAME = re.compile(r"小红书|大众点评|百度|高德|腾讯地图|微博|谷歌|Google", re.IGNORECASE)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument(
        "--input",
        default="data/research/facility-description-web-crawl-2026-08-09/curated-facility-descriptions.json",
    )
    parser.add_argument(
        "--hours-input",
        default="data/research/facility-description-web-crawl-2026-08-09/curated-place-hours.json",
    )
    parser.add_argument("--backup-dir", default="data/backups")
    parser.add_argument("--normalize-hours", action="store_true")
    parser.add_argument("--sync-xhs-images", action="store_true")
    parser.add_argument(
        "--xhs-state-dir",
        default="data/research/xhs-full-2022-2026-08-02/places",
    )
    parser.add_argument(
        "--xhs-curation",
        default="data/research/xhs-full-2022-2026-08-02/image-curation.json",
    )
    return parser.parse_args()


def photo_digest(connection):
    rows = connection.execute(
        "SELECT id, placeId, url, sortOrder, createdAt FROM PlacePhoto ORDER BY id"
    ).fetchall()
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), default=str)
    return len(rows), hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_entries(connection, research_dir, entries):
    if not entries:
        raise ValueError("curated description list is empty")
    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("curated description list contains duplicate ids")
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT id, name, category FROM Place WHERE id IN ({placeholders})",
        ids,
    ).fetchall()
    places = {row[0]: {"name": row[1], "category": row[2]} for row in rows}
    if set(ids) != set(places):
        raise ValueError(f"unknown place ids: {sorted(set(ids) - set(places))}")
    for entry in entries:
        description = entry["description"].strip()
        place = places[entry["id"]]
        if entry.get("nameForAudit") != place["name"]:
            raise ValueError(f"name mismatch for {entry['id']}")
        if not description or description != entry["description"]:
            raise ValueError(f"empty or padded description for {entry['id']}")
        if TRAILING_PUNCTUATION.search(description):
            raise ValueError(f"trailing punctuation for {entry['id']}")
        if GENERIC_ACTIVITY.search(description):
            raise ValueError(f"generic activity prose for {entry['id']}")
        if CHANNEL_NAME.search(description):
            raise ValueError(f"channel name in description for {entry['id']}")
        if entry["nameForAudit"] in description:
            raise ValueError(f"place name in description for {entry['id']}")
        for evidence in entry.get("evidence", []):
            if not (research_dir / evidence).is_file():
                raise ValueError(f"missing evidence for {entry['id']}: {evidence}")


def validate_hours(connection, research_dir, entries):
    if not entries:
        return
    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("curated hours list contains duplicate ids")
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT id, name FROM Place WHERE id IN ({placeholders})",
        ids,
    ).fetchall()
    places = {row[0]: row[1] for row in rows}
    if set(ids) != set(places):
        raise ValueError(f"unknown hours place ids: {sorted(set(ids) - set(places))}")
    for entry in entries:
        hours = entry["hours"].strip()
        if entry.get("nameForAudit") != places[entry["id"]]:
            raise ValueError(f"hours name mismatch for {entry['id']}")
        if not hours or hours != entry["hours"] or "现场公示" in hours:
            raise ValueError(f"invalid curated hours for {entry['id']}")
        if not re.search(r"\d{1,2}:\d{2}", hours):
            raise ValueError(f"hours lack explicit time for {entry['id']}")
        for evidence in entry.get("evidence", []):
            if not (research_dir / evidence).is_file():
                raise ValueError(f"missing hours evidence for {entry['id']}: {evidence}")


def load_curated_xhs_images(state_dir, curation_path):
    curation = json.loads(curation_path.read_text(encoding="utf-8"))
    reviewed_ids = set(curation.get("selections", {}))
    images = {}
    project_root = Path.cwd().resolve()
    for place_id in reviewed_ids:
        state_path = state_dir / f"{place_id}.json"
        if not state_path.is_file():
            raise ValueError(f"missing XHS state for {place_id}")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        selected = []
        for image in state.get("images", []):
            url = image.get("url", "")
            if not url.startswith("/uploads/xhs-full/"):
                raise ValueError(f"unexpected XHS image URL for {place_id}: {url}")
            local_path = project_root / "admin" / "public" / url.removeprefix("/")
            if not local_path.is_file():
                raise ValueError(f"missing XHS image file for {place_id}: {local_path}")
            selected.append(url)
        images[place_id] = selected
    return images


def sync_xhs_images(connection, curated_images, created_at):
    removed = 0
    added = 0
    changed_ids = set()
    for place_id, selected_urls in curated_images.items():
        existing = connection.execute(
            "SELECT id, url FROM PlacePhoto WHERE placeId = ? AND url LIKE '/uploads/xhs-full/%'",
            (place_id,),
        ).fetchall()
        if existing:
            connection.execute(
                "DELETE FROM PlacePhoto WHERE placeId = ? AND url LIKE '/uploads/xhs-full/%'",
                (place_id,),
            )
            removed += len(existing)
            changed_ids.add(place_id)
        other_count = connection.execute(
            "SELECT COUNT(*) FROM PlacePhoto WHERE placeId = ?",
            (place_id,),
        ).fetchone()[0]
        slots = max(0, 5 - other_count)
        for offset, url in enumerate(selected_urls[:slots]):
            photo_id = "enrich_" + hashlib.sha256(
                f"{place_id}\n{url}".encode("utf-8")
            ).hexdigest()[:24]
            connection.execute(
                "INSERT INTO PlacePhoto (id, placeId, url, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)",
                (photo_id, place_id, url, other_count + offset, created_at + added),
            )
            added += 1
            changed_ids.add(place_id)
    return removed, added, changed_ids


def main():
    args = parse_args()
    database = Path(args.database).resolve()
    input_path = Path(args.input).resolve()
    research_dir = input_path.parent
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    entries = payload["descriptions"]
    hours_path = Path(args.hours_input).resolve()
    hours_entries = []
    if hours_path.is_file():
        hours_entries = json.loads(hours_path.read_text(encoding="utf-8"))["hours"]
    curated_images = {}
    if args.sync_xhs_images:
        curated_images = load_curated_xhs_images(
            Path(args.xhs_state_dir).resolve(),
            Path(args.xhs_curation).resolve(),
        )

    with sqlite3.connect(database) as connection:
        validate_entries(connection, research_dir, entries)
        validate_hours(connection, hours_path.parent, hours_entries)
        place_count = connection.execute("SELECT COUNT(*) FROM Place").fetchone()[0]
        before_photos = photo_digest(connection)

    backup_dir = Path(args.backup_dir).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"dev-before-place-enrichment-{time.strftime('%Y%m%d-%H%M%S')}.db"
    with sqlite3.connect(database) as source, sqlite3.connect(backup_path) as destination:
        source.backup(destination)

    updated_at = int(time.time() * 1000)
    curated = {entry["id"]: entry["description"] for entry in entries}
    with sqlite3.connect(database) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "UPDATE Place SET description = '', pushedFingerprint = '', updatedAt = ?",
            (updated_at,),
        )
        connection.executemany(
            "UPDATE Place SET description = ? WHERE id = ?",
            [(description, place_id) for place_id, description in curated.items()],
        )
        normalized_hours = 0
        if args.normalize_hours:
            normalized_hours = connection.execute(
                "UPDATE Place SET hours = '—', pushedFingerprint = '', updatedAt = ? "
                "WHERE TRIM(hours) = '' OR hours LIKE '%现场公示%'",
                (updated_at,),
            ).rowcount
        if hours_entries:
            connection.executemany(
                "UPDATE Place SET hours = ?, pushedFingerprint = '', updatedAt = ? WHERE id = ?",
                [(entry["hours"], updated_at, entry["id"]) for entry in hours_entries],
            )
        removed_photos = 0
        added_photos = 0
        changed_photo_places = set()
        if args.sync_xhs_images:
            removed_photos, added_photos, changed_photo_places = sync_xhs_images(
                connection, curated_images, updated_at
            )
            if changed_photo_places:
                placeholders = ",".join("?" for _ in changed_photo_places)
                connection.execute(
                    f"UPDATE Place SET pushedFingerprint = '', updatedAt = ? WHERE id IN ({placeholders})",
                    (updated_at, *sorted(changed_photo_places)),
                )
        connection.commit()
        after_place_count = connection.execute("SELECT COUNT(*) FROM Place").fetchone()[0]
        after_photos = photo_digest(connection)
        nonempty_count = connection.execute(
            "SELECT COUNT(*) FROM Place WHERE description <> ''"
        ).fetchone()[0]

    if place_count != after_place_count:
        raise RuntimeError("place count changed during description update")
    if not args.sync_xhs_images and before_photos != after_photos:
        raise RuntimeError("PlacePhoto changed during description update")
    print(json.dumps({
        "database": str(database),
        "backup": str(backup_path),
        "placeCount": after_place_count,
        "curatedDescriptions": len(curated),
        "nonemptyDescriptions": nonempty_count,
        "normalizedHours": normalized_hours,
        "curatedHours": len(hours_entries),
        "removedXhsPhotos": removed_photos,
        "addedScenePhotos": added_photos,
        "placePhotoCount": after_photos[0],
        "placePhotoSha256": after_photos[1],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
