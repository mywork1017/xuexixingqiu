#!/usr/bin/env python3
"""Remove photos rejected by final visual QA and compact per-place order."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "admin" / "prisma" / "dev.db"
BACKUP_DIR = ROOT / "data" / "backups"

REJECTED_PHOTO_IDS = {
    "enrich_ef79045a16ddcbed5782b06a": "visible platform watermark",
    "webphoto_a6dc953416c3407ca1b5f1085469c9f5": "collage and text overlay",
    "webphoto_ab6296807c584aae95d37c3108f6627a": "collage and text overlay",
    "webphoto_9142ea9a952c47c3a9e1d4d61cd26708": "screenshot annotation boxes",
    "webphoto_d55d21a2c8ee4cde967a79bf4560767a": "visible platform watermark",
    "webphoto_44b8eeffecc444d7a488e2cd86f713d6": "large text overlay",
    "webphoto_897eb06fcf1c49c7b10748c42774e191": "visible platform watermark",
    "webphoto_310de50371234c858f73774db7feba72": "visible platform watermark",
    "enrich_80b191e8a2e20dd9f7f0788a": "repeated diagonal watermark",
    "webphoto_83f2b0332ab442599e737d8ea296be5c": "near-duplicate scene",
    "webphoto_1884902b1b244da98f371977d9c42d2c": "near-duplicate scene",
    "cmsbprefb00091b6hlie06hql": "near-duplicate food scene",
    "webphoto_cf6de03b0a0b49b0b5bb0514f931acbf": "near-duplicate event scene",
    "webphoto_0194dad1139a4bf7bd7918bdd3a42007": "near-duplicate event scene",
    "webphoto_7bdd8f7b9c024755b7042c92a84eefa8": "near-duplicate reading room scene",
    "webphoto_ae0ce72d76624600ad30310839443f56": "visible platform watermark",
    "webphoto_103484215af3475ea3c3a82deda57520": "visible platform watermark",
    "enrich_fd663f4708d992d851e1fcb8": "visible overlay icon",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in REJECTED_PHOTO_IDS)
    rows = connection.execute(
        f"SELECT id, placeId, url FROM PlacePhoto WHERE id IN ({placeholders})",
        tuple(REJECTED_PHOTO_IDS),
    ).fetchall()
    found_ids = {row["id"] for row in rows}
    missing_ids = sorted(set(REJECTED_PHOTO_IDS) - found_ids)
    affected_place_ids = sorted({row["placeId"] for row in rows})

    print(f"matched={len(rows)} missing={len(missing_ids)} places={len(affected_place_ids)}")
    for row in rows:
        print(f"remove {row['id']} {row['url']} ({REJECTED_PHOTO_IDS[row['id']]})")
    if missing_ids:
        print("already missing: " + ", ".join(missing_ids))
    if not args.apply:
        print("dry run; pass --apply to update database")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"dev-before-final-photo-qa-{stamp}.db"
    connection.close()
    shutil.copy2(DB_PATH, backup_path)

    connection = sqlite3.connect(DB_PATH)
    with connection:
        connection.execute(
            f"DELETE FROM PlacePhoto WHERE id IN ({placeholders})",
            tuple(REJECTED_PHOTO_IDS),
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
