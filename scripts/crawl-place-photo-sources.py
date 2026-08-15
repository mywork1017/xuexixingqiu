#!/usr/bin/env python3
"""Archive multi-engine image-search results for place photo enrichment."""

import argparse
import asyncio
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from urllib.parse import quote_plus, urlsplit, parse_qsl

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


CHANNELS = ("baidu-images", "bing-images", "sogou-images", "360-images")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument("--research-dir", default="data/research/place-photo-crawl-2026-08-10")
    parser.add_argument("--channels", default=",".join(CHANNELS))
    parser.add_argument("--category", choices=("图书馆", "食堂"))
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def load_places(database, category, offset, limit):
    query = """
        SELECT p.id, p.name, p.category, p.address, COUNT(ph.id) AS photoCount
        FROM Place p LEFT JOIN PlacePhoto ph ON ph.placeId = p.id
    """
    params = []
    if category:
        query += " WHERE p.category = ?"
        params.append(category)
    query += " GROUP BY p.id HAVING photoCount < 5 ORDER BY p.rowid LIMIT ? OFFSET ?"
    params.extend((limit if limit > 0 else -1, offset))
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(query, params)]


def search_name(name):
    value = re.sub(r"[（）()]", " ", name).replace("“", "").replace("”", "")
    return re.sub(r"\s+", " ", value).strip()


def channel_url(channel, place):
    name = search_name(place["name"])
    query = f'"{name}" 上海 实景 照片'
    encoded = quote_plus(query)
    if channel == "baidu-images":
        return f"https://image.baidu.com/search/index?tn=baiduimage&word={encoded}", query
    if channel == "bing-images":
        return f"https://www.bing.com/images/search?q={encoded}&form=HDRSC2", query
    if channel == "sogou-images":
        return f"https://pic.sogou.com/pics?query={encoded}", query
    if channel == "360-images":
        return f"https://image.so.com/i?q={encoded}", query
    raise ValueError(f"unsupported channel: {channel}")


def request_key(url):
    parsed = urlsplit(url)
    return parsed.netloc.lower(), parsed.path.rstrip("/"), tuple(sorted(parse_qsl(parsed.query)))


def json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def save_result(bundle_dir, job, result):
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "raw.html").write_text(result.html or "", encoding="utf-8")
    payload = {
        "place": job["place"], "channel": job["channel"], "query": job["query"],
        "requestedUrl": job["url"], "resultUrl": result.url,
        "success": bool(result.success), "statusCode": result.status_code,
        "error": result.error_message or "", "metadata": json_safe(result.metadata or {}),
        "media": json_safe(result.media or {}), "networkRequests": json_safe(result.network_requests or []),
    }
    (bundle_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return payload


async def crawl(args):
    research_dir = Path(args.research_dir)
    channels = tuple(item.strip() for item in args.channels.split(",") if item.strip())
    if any(channel not in CHANNELS for channel in channels):
        raise ValueError(f"channels must come from {CHANNELS}")
    jobs = []
    places = load_places(args.database, args.category, args.offset, args.limit)
    for place in places:
        for channel in channels:
            url, query = channel_url(channel, place)
            digest = hashlib.sha256(f"v1\n{channel}\n{query}\n{url}".encode()).hexdigest()[:12]
            bundle_dir = research_dir / "pages" / channel / place["id"] / digest
            if (bundle_dir / "result.json").exists() and not args.refresh:
                continue
            jobs.append({"place": place, "channel": channel, "query": query, "url": url, "bundleDir": bundle_dir})

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS, word_count_threshold=1, page_timeout=50000,
        wait_for_images=True, delay_before_return_html=0.8, scan_full_page=True,
        max_scroll_steps=4, simulate_user=True, override_navigator=True,
        capture_network_requests=False, remove_overlay_elements=True,
        semaphore_count=max(1, min(args.batch_size, 4)),
    )
    browser_config = BrowserConfig(
        headless=True, verbose=False, enable_stealth=True,
        viewport_width=1440, viewport_height=1000, max_pages_before_recycle=50,
    )
    records = []
    async with AsyncWebCrawler(config=browser_config) as crawler:
        for start in range(0, len(jobs), args.batch_size):
            batch = jobs[start:start + args.batch_size]
            try:
                results = await crawler.arun_many([job["url"] for job in batch], config=run_config)
            except Exception as error:
                results = []
                for job in batch:
                    job["bundleDir"].mkdir(parents=True, exist_ok=True)
                    payload = {"place": job["place"], "channel": job["channel"], "query": job["query"],
                               "requestedUrl": job["url"], "success": False, "statusCode": 0,
                               "error": str(error), "media": {}, "networkRequests": []}
                    (job["bundleDir"] / "result.json").write_text(
                        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                    records.append(payload)
            pending = {request_key(job["url"]): job for job in batch}
            for result in results:
                job = pending.pop(request_key(result.url), None)
                if not job:
                    continue
                record = save_result(job["bundleDir"], job, result)
                records.append(record)
                print(json.dumps({"id": job["place"]["id"], "channel": job["channel"],
                                  "success": record["success"], "status": record["statusCode"],
                                  "images": len(record["media"].get("images", []))}, ensure_ascii=False), flush=True)

    research_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"placeCount": len(places), "scheduledCount": len(jobs), "savedCount": len(records),
                "channels": channels, "successCount": sum(item["success"] for item in records)}
    (research_dir / "crawl-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(crawl(parse_args()))
