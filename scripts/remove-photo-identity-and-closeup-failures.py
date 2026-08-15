#!/usr/bin/env python3
"""Remove Codex-reviewed wrong-place, portrait, and close-person photos."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "admin" / "prisma" / "dev.db"
VISION_PATH = ROOT / "data" / "research" / "active-photo-identity-vision-2026-08-10.jsonl"
BACKUP_DIR = ROOT / "data" / "backups"

WRONG_PLACE_IDS = {
    "webphoto_b8a309cb9be34e658adef4080fc9f392": "Shanghai Library image assigned to Huaihai Middle Road Subdistrict Library",
    "webphoto_38d0adf8776244cfaa0d76e5a19eca77": "Shanghai Library Xujiahui repository assigned to Xujiahui Subdistrict Library",
    "webphoto_d23d68f509894fceb50cce1b9dc0f0fa": "historic Bund exhibition image assigned to Bund Subdistrict Library",
    "webphoto_c3276c93d7ee45da8585ec7f38804265": "historic Bund exhibition image assigned to Bund Subdistrict Library",
    "webphoto_a35adb04611c4ddfbf13ad2d809f1ab3": "Fudan Zhangjiang campus library assigned to Zhangjiang Library",
    "webphoto_2673a5e92a294248bd23f236578935ef": "Tianshan Road military-support library assigned to Changning District Library",
    "webphoto_3a0512ddb37149c7a1f1fdaaaefb1a08": "Cai Yuanpei former residence display assigned to Langxia Town Library",
    "webphoto_b499a5218ab641abb8e96f976da2a11b": "Pudong Library Nanhui branch assigned to Huinan Town Library",
    "webphoto_3c881688cfd04f9c97f6972693f5a403": "Wujiaochang Town or Changhai Road library assigned to Wujiaochang Subdistrict Library",
    "webphoto_5ef4305dc8bf438a989863809465638c": "Shanghai Children's Library assigned to Putuo District Library",
    "webphoto_df38ae7e99874da48e85bbc0fba763d4": "employee reading room assigned to Heqing Town Library",
    "webphoto_6ce17ada93864613a8dc1290e4054b64": "Minhang city reading room assigned to Meilong Town Library",
    "webphoto_4effee43a3354cd8ad77cfc48e8cd3f1": "Da Ling Hao Wan Library assigned to Minhang District Library",
    "webphoto_99cb449f6a454107bc543e9445dab0d1": "Da Ling Hao Wan Library assigned to Minhang District Library",
    "webphoto_5d0025c6e33849a3bbf456a473238c42": "Da Ling Hao Wan Library assigned to Minhang District Library",
    "webphoto_bd2335d580df4929ab59b27b14333c7d": "Xujiahui Academy assigned to Xujiahui Subdistrict Library",
    "webphoto_2c601605f27b46f0a54476822650ef2c": "Xujiahui Academy assigned to Xujiahui Subdistrict Library",
    "webphoto_33978987d8474bcea90cb984eeede3e8": "North Bund canteen assigned to Bund Subdistrict canteen",
}

CODEX_VISUAL_REJECT_IDS = {
    "webphoto_6ce530eeb520496bb3176a35daed262d": "posed dining group",
    "webphoto_a18b42e53af044219fdc67a58ccd9ec3": "posed award group",
    "webphoto_e3dcc24b9eb94fd9a435fe26cf2b0079": "close dining subjects",
    "webphoto_dc7662620c504e959adb27c04c0649fb": "posed award group",
    "webphoto_e8bf1df487bb4a5f85f30bb742124478": "posed group portrait",
    "webphoto_5778c5acbea94b789ff5a14af443d72e": "posed group portrait",
    "webphoto_a78887623f26402abec8c036a83ac914": "close dining subjects",
    "webphoto_a33309420468477cbda9c676618c5147": "close dining subjects",
    "webphoto_105ccd2cc44d45b6b091a1f2c4a8983d": "close dining subjects",
    "webphoto_81a3fd62b7044f6d9c796590941f71dd": "posed ceremony group",
}


def load_closeup_urls() -> dict[str, str]:
    rejected = {}
    for line in VISION_PATH.read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        max_face = max((float(region["area"]) for region in item.get("faces", [])), default=0.0)
        max_human = max((float(region["area"]) for region in item.get("humans", [])), default=0.0)
        if max_face >= 0.012 or max_human >= 0.4:
            url = item["path"].removeprefix("admin/public")
            rejected[url] = f"close-person risk (face={max_face:.4f}, human={max_human:.4f})"
    return rejected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    closeup_urls = load_closeup_urls()
    explicit = {**WRONG_PLACE_IDS, **CODEX_VISUAL_REJECT_IDS}
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    rows = [dict(row) for row in connection.execute(
        "SELECT id, placeId, url FROM PlacePhoto ORDER BY placeId, sortOrder, id"
    )]
    rejected = []
    for row in rows:
        reason = explicit.get(row["id"]) or closeup_urls.get(row["url"])
        if reason:
            rejected.append({**row, "reason": reason})
    affected_place_ids = sorted({row["placeId"] for row in rejected})

    print(f"matched={len(rejected)} places={len(affected_place_ids)} wrongPlace={sum(row['id'] in WRONG_PLACE_IDS for row in rejected)}")
    for row in rejected:
        print(f"remove {row['id']} {row['url']} ({row['reason']})")
    if not args.apply:
        print("dry run; pass --apply to update database")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"dev-before-photo-identity-qa-{stamp}.db"
    connection.close()
    shutil.copy2(DB_PATH, backup_path)

    rejected_ids = [row["id"] for row in rejected]
    placeholders = ",".join("?" for _ in rejected_ids)
    connection = sqlite3.connect(DB_PATH)
    with connection:
        connection.execute(
            f"DELETE FROM PlacePhoto WHERE id IN ({placeholders})",
            rejected_ids,
        )
        now_ms = int(time.time() * 1000)
        for place_id in affected_place_ids:
            remaining = connection.execute(
                "SELECT id FROM PlacePhoto WHERE placeId = ? ORDER BY sortOrder, id",
                (place_id,),
            ).fetchall()
            for sort_order, (photo_id,) in enumerate(remaining):
                connection.execute(
                    "UPDATE PlacePhoto SET sortOrder = ? WHERE id = ?",
                    (sort_order, photo_id),
                )
            connection.execute(
                "UPDATE Place SET updatedAt = ?, pushedFingerprint = '' WHERE id = ?",
                (now_ms, place_id),
            )
    connection.close()
    print(f"applied; backup={backup_path}")


if __name__ == "__main__":
    main()
