#!/usr/bin/env python3
"""Validate, deduplicate, crop, and optionally add crawled place photos to SQLite."""

import argparse
import asyncio
import hashlib
import html
import io
import json
import re
import shutil
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from PIL import Image, ImageOps


CHANNEL_PRIORITY = {"baidu-images": 5, "sogou-images": 4, "bing-images": 3, "360-images": 2}
BLOCKED_HOST_PARTS = ("logo", "icon", "avatar", "emoji", "sprite", "favicon")
EXTERNAL_GEOGRAPHY = re.compile(
    r"广东|广州|北京|杭州|苏州|天津|武汉|成都|重庆|西安|青岛|厦门|福州|南宁|"
    r"昆明|长沙|郑州|合肥|济南|沈阳|大连|哈尔滨|长春|太原|石家庄|兰州|"
    r"乌鲁木齐|香港|澳门|台湾|山东|浙江|江苏|福建|四川|湖北|湖南|河南|河北"
)
PLACE_SUFFIXES = (
    "图书馆", "食堂", "餐厅", "助餐点", "助餐站", "分馆",
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument("--research-dir", default="data/research/place-photo-crawl-2026-08-10")
    parser.add_argument("--output-root", default="")
    parser.add_argument("--report", default="data/research/place-photo-crawl-2026-08-10/prepare-report.json")
    parser.add_argument("--max-per-place", type=int, default=5)
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def normalize(value):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value).lower())


def place_aliases(name):
    base = re.sub(r"[（(].*?[）)]", "", str(name))
    values = {normalize(name), normalize(base)}
    expanded = set()
    for value in values:
        local = value.replace("上海市", "").replace("上海", "")
        expanded.update((value, local))
        for suffix in PLACE_SUFFIXES:
            normalized_suffix = normalize(suffix)
            if local.endswith(normalized_suffix):
                expanded.add(local[:-len(normalized_suffix)])
    return {value for value in expanded if len(value) >= 4}


def matches_place(name, title, category=""):
    normalized_title = normalize(title)
    if not normalized_title:
        return False
    if any(alias in normalized_title for alias in place_aliases(name)):
        return True
    if EXTERNAL_GEOGRAPHY.search(title) and "上海" not in title:
        return False
    if ("省立" in title or ("县图书馆" in title and "县" not in name)):
        return False
    return False


def parse_bing(raw_html):
    for match in re.finditer(r'\bm="(\{&quot;.*?\})"', raw_html, re.DOTALL):
        try:
            item = json.loads(html.unescape(match.group(1)))
        except (json.JSONDecodeError, TypeError):
            continue
        yield {"url": item.get("murl", ""), "title": item.get("t", ""),
               "sourcePage": item.get("purl", ""), "declaredWidth": 0, "declaredHeight": 0}


def parse_360(raw_html):
    decoder = json.JSONDecoder()
    cursor = 0
    while True:
        marker = raw_html.find('"list":[', cursor)
        if marker < 0:
            return
        start = marker + len('"list":')
        cursor = start + 1
        try:
            items, end = decoder.raw_decode(raw_html[start:])
            cursor = start + end
        except json.JSONDecodeError:
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                yield {"url": item.get("img", ""), "title": item.get("title", ""),
                       "sourcePage": item.get("link", ""),
                       "declaredWidth": int(item.get("width") or 0),
                       "declaredHeight": int(item.get("height") or 0)}


def parse_baidu(raw_html):
    decoder = json.JSONDecoder()
    cursor = 0
    while True:
        marker = raw_html.find('"images":[', cursor)
        if marker < 0:
            return
        start = marker + len('"images":')
        cursor = start + 1
        try:
            items, end = decoder.raw_decode(raw_html[start:])
            cursor = start + end
        except json.JSONDecodeError:
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                yield {"url": item.get("objurl", ""), "title": item.get("titleShow", ""),
                       "sourcePage": item.get("fromUrl", ""),
                       "declaredWidth": int(item.get("width") or 0),
                       "declaredHeight": int(item.get("height") or 0)}


def extract_candidates(result_path):
    record = json.loads(result_path.read_text(encoding="utf-8"))
    place = record.get("place") or {}
    channel = record.get("channel", "")
    if channel not in CHANNEL_PRIORITY or not place.get("id"):
        return place, []
    raw_path = result_path.with_name("raw.html")
    candidates = []
    if channel == "sogou-images":
        for image in (record.get("media") or {}).get("images", []):
            candidates.append({"url": image.get("src", ""), "title": image.get("desc", ""),
                               "sourcePage": record.get("resultUrl") or record.get("requestedUrl", ""),
                               "declaredWidth": 0, "declaredHeight": 0})
    elif raw_path.is_file():
        raw_html = raw_path.read_text(encoding="utf-8", errors="replace")
        parser = {
            "baidu-images": parse_baidu,
            "bing-images": parse_bing,
            "360-images": parse_360,
        }[channel]
        candidates.extend(parser(raw_html))
    selected = []
    for candidate in candidates:
        url = html.unescape(candidate["url"]).replace("http://", "https://", 1)
        host_and_path = f"{urlparse(url).netloc}{urlparse(url).path}".lower()
        if not url.startswith("https://") or any(part in host_and_path for part in BLOCKED_HOST_PARTS):
            continue
        if not matches_place(place.get("name", ""), candidate.get("title", ""), place.get("category", "")):
            continue
        selected.append({**candidate, "url": url, "channel": channel,
                         "archiveResult": str(result_path)})
    return place, selected


def load_state(database):
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        places = {row["id"]: dict(row) for row in connection.execute(
            "SELECT id, name, category FROM Place WHERE category IN ('图书馆', '食堂')"
        )}
        counts = defaultdict(int)
        next_orders = defaultdict(int)
        urls = defaultdict(list)
        for row in connection.execute("SELECT placeId, url, sortOrder FROM PlacePhoto ORDER BY sortOrder, id"):
            counts[row["placeId"]] += 1
            next_orders[row["placeId"]] = max(next_orders[row["placeId"]], row["sortOrder"] + 1)
            urls[row["placeId"]].append(row["url"])
    return places, counts, next_orders, urls


def dhash(image):
    resized = image.convert("L").resize((9, 8))
    pixels = list(resized.get_flattened_data() if hasattr(resized, "get_flattened_data") else resized.getdata())
    value = 0
    for row in range(8):
        for column in range(8):
            value = (value << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return value


def hamming(left, right):
    return (left ^ right).bit_count()


def prepare_image(data):
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGB")
    width, height = image.size
    if min(width, height) < 420 or max(width, height) / min(width, height) > 3.2:
        raise ValueError(f"unsupported dimensions {width}x{height}")
    if image.resize((64, 64)).entropy() < 3.2:
        raise ValueError("low visual entropy")
    fingerprint = dhash(image)
    output = ImageOps.fit(image, (1024, 1024), method=Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    output.save(buffer, "WEBP", quality=86, method=6)
    return buffer.getvalue(), width, height, fingerprint


async def download_candidates(args, candidates_by_place, places, existing_counts):
    semaphore = asyncio.Semaphore(args.concurrency)
    timeout = aiohttp.ClientTimeout(total=45)
    connector = aiohttp.TCPConnector(limit=args.concurrency, ssl=False)
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36"}
    prepared = defaultdict(list)
    errors = []
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        async def fetch(place_id, candidate):
            async with semaphore:
                try:
                    request_headers = {"Referer": candidate["sourcePage"]} if candidate.get("sourcePage") else {}
                    async with session.get(candidate["url"], headers=request_headers, allow_redirects=True) as response:
                        if response.status >= 400:
                            raise ValueError(f"HTTP {response.status}")
                        if int(response.headers.get("Content-Length", "0") or 0) > 20 * 1024 * 1024:
                            raise ValueError("file too large")
                        data = await response.read()
                    if len(data) > 20 * 1024 * 1024:
                        raise ValueError("file too large")
                    output, width, height, fingerprint = await asyncio.to_thread(prepare_image, data)
                    return place_id, candidate, output, width, height, fingerprint, ""
                except Exception as error:
                    return place_id, candidate, b"", 0, 0, 0, str(error)

        async def process_place(place_id, candidates):
            slots = max(0, args.max_per_place - existing_counts[place_id])
            by_channel = defaultdict(list)
            for candidate in candidates:
                by_channel[candidate["channel"]].append(candidate)
            interleaved = []
            channel_order = ("baidu-images", "sogou-images", "bing-images", "360-images")
            while any(by_channel[channel] for channel in channel_order):
                for channel in channel_order:
                    if by_channel[channel]:
                        interleaved.append(by_channel[channel].pop(0))
            results = await asyncio.gather(*(
                fetch(place_id, candidate)
                for candidate in interleaved[:max(18, slots * 3)]
            ))
            valid_by_channel = defaultdict(list)
            for _, candidate, output, width, height, fingerprint, error in results:
                if error:
                    errors.append({"placeId": place_id, "url": candidate["url"], "error": error})
                    continue
                valid_by_channel[candidate["channel"]].append({
                    **candidate, "data": output, "width": width,
                    "height": height, "dhash": fingerprint,
                })
            ordered = []
            while any(valid_by_channel[channel] for channel in channel_order):
                for channel in channel_order:
                    if valid_by_channel[channel]:
                        ordered.append(valid_by_channel[channel].pop(0))
            selected = []
            for image in ordered:
                if len(selected) >= slots:
                    break
                if any(hamming(image["dhash"], item["dhash"]) <= 7 for item in selected):
                    continue
                selected.append(image)
            return place_id, selected

        place_tasks = [
            asyncio.create_task(process_place(place_id, candidates))
            for place_id, candidates in candidates_by_place.items()
        ]
        for task in asyncio.as_completed(place_tasks):
            place_id, selected = await task
            if selected:
                prepared[place_id] = selected
    return prepared, errors


def save_and_apply(args, prepared, places, existing_counts, next_orders):
    output_root = Path(args.output_root)
    additions = []
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    for place_id, images in prepared.items():
        directory = output_root / place_id
        directory.mkdir(parents=True, exist_ok=True)
        start = next_orders[place_id]
        for offset, image in enumerate(images, start=1):
            path = directory / f"{start + offset:02d}.webp"
            path.write_bytes(image.pop("data"))
            public_url = "/" + str(path.relative_to("admin/public")) if args.apply else str(path)
            source_url = image.pop("url")
            additions.append({**image, "sourceUrl": source_url,
                              "id": f"webphoto_{uuid.uuid4().hex}", "placeId": place_id,
                              "placeName": places[place_id]["name"], "url": public_url,
                              "sortOrder": start + offset - 1, "createdAt": created_at})
    backup = ""
    if args.apply and additions:
        database = Path(args.database)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = Path("data/backups") / f"dev-before-web-photos-{stamp}.db"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(database, backup_path)
        backup = str(backup_path)
        with sqlite3.connect(database) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.executemany(
                "INSERT INTO PlacePhoto (id, placeId, url, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)",
                [(item["id"], item["placeId"], item["url"], item["sortOrder"], item["createdAt"])
                 for item in additions],
            )
            connection.commit()
    return additions, backup


async def main(args):
    if not args.output_root:
        args.output_root = (
            "admin/public/uploads/web-crawl" if args.apply
            else str(Path(args.research_dir) / "prepared-photos")
        )
    places, existing_counts, next_orders, _ = load_state(args.database)
    candidates_by_place = defaultdict(list)
    seen = defaultdict(set)
    for path in sorted(Path(args.research_dir).glob("pages/**/result.json")):
        place, candidates = extract_candidates(path)
        place_id = place.get("id")
        if place_id not in places:
            continue
        candidates.sort(key=lambda item: (
            matches_place(places[place_id]["name"], item["title"], places[place_id]["category"]),
            CHANNEL_PRIORITY[item["channel"]],
            min(item["declaredWidth"], item["declaredHeight"]),
        ), reverse=True)
        for candidate in candidates:
            if candidate["url"] not in seen[place_id]:
                seen[place_id].add(candidate["url"])
                candidates_by_place[place_id].append(candidate)
    prepared, errors = await download_candidates(args, candidates_by_place, places, existing_counts)
    additions, backup = save_and_apply(args, prepared, places, existing_counts, next_orders)
    report = {
        "applied": args.apply, "maxPerPlace": args.max_per_place,
        "candidatePlaces": len(candidates_by_place),
        "candidateCount": sum(map(len, candidates_by_place.values())),
        "preparedPlaces": len(prepared), "preparedCount": len(additions),
        "failedDownloadCount": len(errors), "backup": backup,
        "places": [{"id": place_id, "name": places[place_id]["name"],
                    "before": existing_counts[place_id], "added": len(images),
                    "after": existing_counts[place_id] + len(images)}
                   for place_id, images in sorted(prepared.items()) if images],
        "images": [{key: value for key, value in item.items() if key not in ("dhash",)} for item in additions],
        "errors": errors,
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "applied", "candidatePlaces", "candidateCount", "preparedPlaces", "preparedCount",
        "failedDownloadCount", "backup")}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
