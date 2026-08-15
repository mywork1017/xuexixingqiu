#!/usr/bin/env python3
"""Curate active place galleries for variety, interior usefulness, and clean edges."""

import argparse
import hashlib
import json
import math
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


INTERIOR_LABELS = {
    "interior_room", "library", "restaurant", "classroom", "interior_shop",
    "bookshelf", "furniture", "table", "chair", "chair_other", "desk",
}
PEOPLE_LABELS = {"people", "adult", "child", "crowd"}
FACILITY_LABELS = {
    "bookshelf", "furniture", "table", "chair", "chair_other", "desk", "cabinet",
    "computer", "consumer_electronics", "machine", "television", "door", "stairs",
    "counter", "display_case", "armchair", "stool",
}
EXTERIOR_LABELS = {
    "outdoor", "building", "storefront", "architecture", "house", "apartment",
    "sky", "blue_sky", "street", "road", "sidewalk", "facade",
}
FOOD_LABELS = {"food", "bowl", "plate", "tableware", "utensil", "soup", "meal"}
WATERMARK_WORDS = re.compile(
    r"大众点评|点评|小红书|水印|抖音|视频号|微博|微信|公众号|搜狐|网易|腾讯|百度|"
    r"新民|上观|新闻晨报|东方网|上海发布|付费专|livespa|@|©|copyright|photo\s*by|摄[影图]|图[片源]",
    re.I,
)
DATE_STAMP = re.compile(r"(?:\d{2,4})[./年-]\d{1,2}[./月-]\d{1,2}")
MANUAL_EXCLUDED_URLS = {
    "/uploads/web-crawl/cmsl3yuq7000axgo0effsla0q/03.webp",
    "/uploads/web-crawl/cmsl5pfh8001i10qsbaag2jo4/01.webp",
    "/uploads/web-crawl/place_12bklzp/02.webp",
    "/uploads/web-crawl/place_17a01g3/05.webp",
    "/uploads/web-crawl/place_17a01g3/10.webp",
    "/uploads/web-crawl/place_17a01g3/09.webp",
    "/uploads/web-crawl/place_17fvyv1/04.webp",
    "/uploads/web-crawl/place_1anm9kt/02.webp",
    "/uploads/web-crawl/place_1e6r5z7/04.webp",
    "/uploads/web-crawl/place_1g4xz4e/01.webp",
    "/uploads/web-crawl/place_1gcslbu/06.webp",
    "/uploads/web-crawl/place_1gxhf9a/04.webp",
    "/uploads/xhs-full/place_1h3scyd/03.webp",
    "/uploads/web-crawl/place_1ju9ggz/09.webp",
    "/uploads/web-crawl/place_1o5d33d/02.webp",
    "/uploads/web-crawl/place_4tyid6/06.webp",
    "/uploads/web-crawl/place_4tyid6/04.webp",
    "/uploads/web-crawl/place_58p9oc/03.webp",
    "/uploads/xhs-discovery/6904ae790000000004010bcc/02.webp",
    "/uploads/xhs-discovery/6904ae790000000004010bcc/03.webp",
    "/uploads/web-crawl/place_9drf0a/03.webp",
    "/uploads/web-crawl/place_ajxkcn/01.webp",
    "/uploads/xhs-full/place_b1kamu/01.webp",
    "/uploads/web-crawl/place_bgg3t7/04.webp",
    "/uploads/web-crawl/place_btktw9/03.webp",
    "/uploads/web-crawl/place_ck6c9n/07.webp",
    "/uploads/web-crawl/place_coexmi/04.webp",
    "/uploads/web-crawl/place_coexmi/06.webp",
    "/uploads/xhs-full/place_g3soqb/03.webp",
    "/uploads/web-crawl/place_lbk3a7/05.webp",
    "/uploads/web-crawl/place_lbk3a7/02.webp",
    "/uploads/web-crawl/place_m2dseq/02.webp",
    "/uploads/xhs-discovery/690caecb000000000402be5d/01.webp",
    "/uploads/xhs-discovery/690caecb000000000402be5d/02.webp",
    "/uploads/web-crawl/place_mrspz6/08.webp",
    "/uploads/web-crawl/place_nbnipp/03.webp",
    "/uploads/web-crawl/place_ou46s6/01.webp",
    "/uploads/web-crawl/place_rd02n6/05.webp",
    "/uploads/web-crawl/place_us4ilt/03.webp",
    "/uploads/web-crawl/place_us4ilt/05.webp",
    "/uploads/web-crawl/place_uviqcq/04.webp",
    "/uploads/web-crawl/place_vcd8y4/01.webp",
    "/uploads/web-crawl/place_vcd8y4/02.webp",
    "/uploads/web-crawl/place_wia1gi/02.webp",
    "/uploads/web-crawl/place_wia1gi/01.webp",
    "/uploads/web-crawl/place_z7116a/04.webp",
    "/uploads/web-crawl/place_zd3c42/05.webp",
    "/uploads/web-crawl/place_zr9aa0/08.webp",
    "/uploads/web-crawl/place_zr9aa0/09.webp",
    "/uploads/web-crawl/place_1ffbblg/01.webp",
    "/uploads/web-crawl/place_1ni9p4o/02.webp",
    "/uploads/web-crawl/place_4h6j5r/04.webp",
    "/uploads/web-crawl/place_4tyid6/08.webp",
    "/uploads/web-crawl/place_5opekl/04.webp",
    "/uploads/web-crawl/place_f827hf/03.webp",
    "/uploads/web-crawl/place_m2dseq/10.webp",
    "/uploads/xhs-full/place_s0kgpr/02.webp",
    "/uploads/web-crawl/place_zr9aa0/05.webp",
    "/uploads/web-crawl/cmsl5pfh9002710qsywe0f1jo/05.webp",
    "/uploads/web-crawl/place_1tt6bbo/04.webp",
    "/uploads/web-crawl/place_18ap2t4/01.webp",
    "/uploads/web-crawl/place_1h62ygw/09.webp",
    "/uploads/xhs-full/place_15ni1r/02.webp",
    "/uploads/web-crawl/place_17a01g3/06.webp",
    "/uploads/web-crawl/place_17a01g3/04.webp",
    "/uploads/web-crawl/place_1ffbblg/03.webp",
    "/uploads/web-crawl/place_1lnmzzd/08.webp",
    "/uploads/web-crawl/place_4tyid6/05.webp",
    "/uploads/web-crawl/place_mdhfy6/06.webp",
    "/uploads/web-crawl/place_mdhfy6/07.webp",
    "/uploads/xhs-full/place_r6qrzi/03.webp",
    "/uploads/web-crawl/place_uafqzf/01.webp",
    "/uploads/web-crawl/place_4z03wb/02.webp",
    "/uploads/xhs-pilot/bund-canteen/02.webp",
    "/uploads/web-crawl/place_uafqzf/02.webp",
    "/uploads/web-crawl/place_zpiss6/07.webp",
    "/uploads/web-crawl/place_zr9aa0/04.webp",
    "/uploads/web-crawl/place_1a04obd/03.webp",
    "/uploads/web-crawl/place_1rxgy7a/08.webp",
    "/uploads/xhs-full/place_rseajv/02.webp",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument("--public-root", default="admin/public")
    parser.add_argument("--vision", default="data/research/place-photo-vision-2026-08-10.jsonl")
    parser.add_argument("--report", default="data/research/place-photo-curation-2026-08-10.json")
    parser.add_argument("--output-root", default="admin/public/uploads/curated-2026-08-10")
    parser.add_argument("--max-per-place", type=int, default=5)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def label_map(analysis):
    return {item["label"]: float(item["confidence"]) for item in analysis["classifications"]}


def maximum(labels, names):
    return max((labels.get(name, 0.0) for name in names), default=0.0)


def is_exterior(labels):
    exterior = maximum(labels, EXTERIOR_LABELS)
    interior = maximum(labels, INTERIOR_LABELS)
    return exterior >= 0.35 and interior < 0.32 and (
        labels.get("outdoor", 0) >= 0.3
        or labels.get("building", 0) >= 0.28
        or labels.get("storefront", 0) >= 0.28
    )


def watermark_observations(analysis):
    explicit = []
    edge_small = []
    for item in analysis["texts"]:
        if item["confidence"] < 0.25:
            continue
        text = re.sub(r"\s+", "", item["text"])
        x0, y0 = item["x"], item["y"]
        x1, y1 = x0 + item["width"], y0 + item["height"]
        near_edge = x0 < 0.16 or x1 > 0.84 or y0 < 0.16 or y1 > 0.84
        if WATERMARK_WORDS.search(text) or (DATE_STAMP.search(text) and near_edge):
            explicit.append(item)
        elif near_edge and item["height"] <= 0.055 and item["width"] <= 0.34:
            edge_small.append(item)
    return explicit, edge_small


def is_close_person(analysis):
    max_face = max((float(item["area"]) for item in analysis.get("faces", [])), default=0.0)
    max_human = max((float(item["area"]) for item in analysis.get("humans", [])), default=0.0)
    return max_face >= 0.012 or max_human >= 0.4


def content_score(category, analysis):
    labels = label_map(analysis)
    interior = maximum(labels, INTERIOR_LABELS)
    people = maximum(labels, PEOPLE_LABELS)
    facility = maximum(labels, FACILITY_LABELS)
    food = maximum(labels, FOOD_LABELS)
    exterior = is_exterior(labels)
    explicit, edge_small = watermark_observations(analysis)
    score = interior * 7 + people * 4 + facility * 3
    score += min(2.0, 0.5 * analysis["faceCount"] + 0.7 * analysis["humanCount"])
    if category == "图书馆":
        score += labels.get("bookshelf", 0) * 4 + labels.get("library", 0) * 3
        score += labels.get("book", 0) * 2 + labels.get("desk", 0) * 2
        if food > 0.65 and interior < 0.25 and maximum(labels, {"bookshelf", "library", "book"}) < 0.25:
            score -= 20
    else:
        score += labels.get("restaurant", 0) * 4 + food * 2
        score += labels.get("table", 0) * 2 + labels.get("chair", 0) * 2
    if exterior:
        score -= 1.5
    if labels.get("document", 0) > 0.6 and interior < 0.25 and people < 0.25:
        score -= 7
    if explicit:
        score -= 12
    score -= min(3, len(edge_small)) * 0.8
    return score, exterior, labels, explicit, edge_small


def hashes(path):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        gray = np.asarray(image.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
        small = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS), dtype=np.int16)
        thumb = np.asarray(image.resize((16, 16), Image.Resampling.LANCZOS), dtype=np.float64)
    spectrum = np.abs(np.fft.fft2(gray))
    low = spectrum[:8, :8]
    phash = low > np.median(low[1:])
    dhash = small[:, :-1] > small[:, 1:]
    normalized = (thumb - thumb.mean()) / max(thumb.std(), 1.0)
    return phash.flatten(), dhash.flatten(), normalized.flatten()


def similar(left, right):
    p_distance = int(np.count_nonzero(left[0] != right[0]))
    d_distance = int(np.count_nonzero(left[1] != right[1]))
    correlation = float(np.dot(left[2], right[2]) / len(left[2]))
    return p_distance <= 10 or d_distance <= 8 or correlation >= 0.94


def focus(labels, exterior):
    if exterior:
        return "exterior"
    scores = {
        "people": maximum(labels, PEOPLE_LABELS),
        "seating": maximum(labels, {"table", "chair", "chair_other", "desk", "restaurant", "classroom"}),
        "shelves": maximum(labels, {"bookshelf", "book", "library"}),
        "facility": maximum(labels, FACILITY_LABELS - {"bookshelf", "table", "chair", "desk"}),
        "food": maximum(labels, FOOD_LABELS),
    }
    return max(scores, key=scores.get)


def crop_ratios(explicit, edge_small):
    left = right = top = bottom = 0.12
    for item in [*explicit, *edge_small]:
        x0, y0 = item["x"], item["y"]
        x1, y1 = x0 + item["width"], y0 + item["height"]
        choices = []
        if x0 < 0.24:
            choices.append((x1 + 0.025, "left"))
        if x1 > 0.76:
            choices.append((1 - x0 + 0.025, "right"))
        if y0 < 0.24:
            choices.append((y1 + 0.025, "bottom"))
        if y1 > 0.76:
            choices.append((1 - y0 + 0.025, "top"))
        if not choices:
            continue
        amount, side = min(choices)
        amount = min(0.22, max(0.12, amount))
        if side == "left": left = max(left, amount)
        elif side == "right": right = max(right, amount)
        elif side == "bottom": bottom = max(bottom, amount)
        else: top = max(top, amount)
    return left, right, top, bottom


def save_clean_image(source_path, target_path, crop):
    with Image.open(source_path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        width, height = image.size
        left, right, top, bottom = crop
        box = (
            round(width * left),
            round(height * top),
            round(width * (1 - right)),
            round(height * (1 - bottom)),
        )
        if box[2] - box[0] < width * 0.55 or box[3] - box[1] < height * 0.55:
            raise ValueError(f"crop too aggressive: {crop}")
        cleaned = image.crop(box)
        cleaned = ImageOps.fit(cleaned, (1024, 1024), method=Image.Resampling.LANCZOS)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        cleaned.save(target_path, "WEBP", quality=88, method=6)


def main(args):
    project_root = Path.cwd()
    public_root = (project_root / args.public_root).resolve()
    vision = {}
    with open(args.vision, encoding="utf-8") as source:
        for line in source:
            item = json.loads(line)
            vision[str((project_root / item["path"]).resolve())] = item

    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    rows = [dict(row) for row in connection.execute(
        """SELECT ph.id, ph.placeId, ph.url, ph.sortOrder, ph.createdAt,
                  p.name AS placeName, p.category
             FROM PlacePhoto ph JOIN Place p ON p.id = ph.placeId
            ORDER BY ph.placeId, ph.sortOrder, ph.id"""
    )]
    file_hashes = {}
    hash_places = defaultdict(set)
    for row in rows:
        path = (public_root / row["url"].lstrip("/")).resolve()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        file_hashes[row["id"]] = digest
        hash_places[digest].add(row["placeId"])
    ambiguous_hashes = {digest for digest, place_ids in hash_places.items() if len(place_ids) > 1}

    by_place = defaultdict(list)
    missing = []
    for row in rows:
        path = (public_root / row["url"].lstrip("/")).resolve()
        analysis = vision.get(str(path))
        if not analysis:
            missing.append(str(path))
            continue
        score, exterior, labels, explicit, edge_small = content_score(row["category"], analysis)
        by_place[row["placeId"]].append({
            **row, "path": path, "analysis": analysis, "score": score,
            "exterior": exterior, "labels": labels, "explicit": explicit,
            "edgeSmall": edge_small, "hashes": hashes(path),
            "closePerson": is_close_person(analysis),
            "blocked": row["url"] in MANUAL_EXCLUDED_URLS or file_hashes[row["id"]] in ambiguous_hashes,
        })
    if missing:
        raise RuntimeError(f"missing Vision results for {len(missing)} photos")

    selected = []
    places_report = []
    removed_reasons = Counter()
    for place_id, photos in by_place.items():
        photos.sort(key=lambda item: (item["score"], -item["sortOrder"]), reverse=True)
        chosen = []
        exterior_count = 0
        focus_counts = Counter()
        for item in photos:
            if item["closePerson"]:
                removed_reasons["close_person"] += 1
                continue
            if item["blocked"]:
                removed_reasons["manual_or_cross_place_duplicate"] += 1
                continue
            if len(chosen) >= args.max_per_place:
                removed_reasons["over_limit"] += 1
                continue
            if item["exterior"] and exterior_count >= 1:
                removed_reasons["extra_exterior"] += 1
                continue
            if any(similar(item["hashes"], current["hashes"]) for current in chosen):
                removed_reasons["near_duplicate"] += 1
                continue
            item_focus = focus(item["labels"], item["exterior"])
            if focus_counts[item_focus] >= 2 and len(photos) > args.max_per_place:
                removed_reasons["repeated_content"] += 1
                continue
            if item["score"] < -1:
                removed_reasons["low_relevance_or_watermark"] += 1
                continue
            item["focus"] = item_focus
            item["crop"] = crop_ratios(item["explicit"], item["edgeSmall"])
            chosen.append(item)
            focus_counts[item_focus] += 1
            exterior_count += int(item["exterior"])
        chosen.sort(key=lambda item: (
            item["exterior"],
            -int(item["analysis"]["humanCount"] > 0 or item["analysis"]["faceCount"] > 0),
            -item["score"],
        ))
        for order, item in enumerate(chosen):
            item["newSortOrder"] = order
            item["newUrl"] = f"/uploads/curated-2026-08-10/{place_id}/{order + 1:02d}.webp"
            selected.append(item)
        places_report.append({
            "placeId": place_id,
            "placeName": photos[0]["placeName"],
            "category": photos[0]["category"],
            "before": len(photos),
            "after": len(chosen),
            "selected": [{
                "id": item["id"], "oldUrl": item["url"], "newUrl": item["newUrl"],
                "score": round(item["score"], 3), "focus": item["focus"],
                "exterior": item["exterior"], "crop": [round(x, 4) for x in item["crop"]],
                "explicitWatermarkText": [text["text"] for text in item["explicit"]],
                "edgeText": [text["text"] for text in item["edgeSmall"]],
            } for item in chosen],
        })

    backup = ""
    if args.apply:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = project_root / "data/backups" / f"dev-before-photo-curation-{stamp}.db"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.database, backup_path)
        backup = str(backup_path.relative_to(project_root))
        for item in selected:
            target = public_root / item["newUrl"].lstrip("/")
            save_clean_image(item["path"], target, item["crop"])
        now = int(datetime.now().timestamp() * 1000)
        chosen_ids = {item["id"] for item in selected}
        connection.execute("BEGIN IMMEDIATE")
        connection.executemany(
            "DELETE FROM PlacePhoto WHERE id = ?",
            [(row["id"],) for row in rows if row["id"] not in chosen_ids],
        )
        connection.executemany(
            "UPDATE PlacePhoto SET url = ?, sortOrder = ? WHERE id = ?",
            [(item["newUrl"], item["newSortOrder"], item["id"]) for item in selected],
        )
        affected = list(by_place)
        connection.executemany(
            "UPDATE Place SET updatedAt = ?, pushedFingerprint = '' WHERE id = ?",
            [(now, place_id) for place_id in affected],
        )
        connection.commit()
    connection.close()

    report = {
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "applied": args.apply,
        "policy": {
            "maxPerPlace": args.max_per_place,
            "maxExteriorPerPlace": 1,
            "priority": ["interior seating and reading/dining activity", "contextual activity without portrait framing", "facilities", "one exterior at most"],
            "watermark": "selected images receive at least 12% border crop; OCR edge hits expand crop up to 22%",
        },
        "beforePhotos": len(rows),
        "afterPhotos": len(selected),
        "placesWithPhotos": len(by_place),
        "maximumAfter": max((item["after"] for item in places_report), default=0),
        "removedReasons": dict(removed_reasons),
        "selectedExterior": sum(item["exterior"] for item in selected),
        "selectedWithPeople": sum(bool(item["analysis"]["faceCount"] or item["analysis"]["humanCount"]) for item in selected),
        "backup": backup,
        "places": places_report,
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "applied", "beforePhotos", "afterPhotos", "placesWithPhotos", "maximumAfter",
        "removedReasons", "selectedExterior", "selectedWithPeople", "backup",
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(parse_args())
