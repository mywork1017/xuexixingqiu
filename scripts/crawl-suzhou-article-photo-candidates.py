#!/usr/bin/env python3
"""Follow exact-place search results and archive large photo candidates."""

import asyncio
import hashlib
import json
import re
import sqlite3
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin

import aiohttp
from PIL import Image
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


DATABASE = Path("admin/prisma/dev.db")
SEARCH_ROOT = Path("data/research/suzhou-photo-refresh-2026-08-16/web/pages/search/baidu")
OUTPUT_ROOT = Path("data/research/suzhou-photo-refresh-2026-08-16/articles")
MAX_PAGES_PER_PLACE = 4
MAX_IMAGES_PER_PLACE = 20
MIN_SHORT_SIDE = 900


def normalize(value):
    return re.sub(r"[\s·•（）()“”'\"《》—–\-_/，,。.：:；;]+", "", str(value or "")).lower()


def branch_name(name):
    match = re.search(r"[（(]([^）)]+)[）)]", name)
    if match:
        return re.sub(r"分馆.*$", "", match.group(1)).replace("苏州书房", "").strip()
    return re.sub(r"分馆.*$", "", re.sub(r"^(苏州书房[·・]|苏州图书馆)", "", name)).strip()


def address_terms(address):
    terms = re.findall(r"([\u4e00-\u9fff]{2,12}(?:路|街|巷|社区|花园|中心|书院|饭店))", address)
    ignored = {"苏州市", "服务中心", "社区服务中心", "市民活动中心"}
    return [term for term in terms if term not in ignored][-3:]


def identity_match(place, text):
    haystack = normalize(text)
    if place["name"] == "苏州图书馆":
        return "北馆" not in text and "第二图书馆" not in text and ("人民路馆" in text or "人民路858号" in haystack)
    branch = normalize(branch_name(place["name"]))
    if len(branch) >= 3 and branch in haystack:
        return True
    exact = normalize(place["name"])
    if exact and exact in haystack:
        return True
    return any(normalize(term) in haystack for term in address_terms(place["address"]))


def load_places():
    with sqlite3.connect(DATABASE) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id,name,category,address FROM Place WHERE address LIKE '苏州市%' OR address LIKE '苏州高新区%' ORDER BY rowid"
        )
        return {row["id"]: dict(row) for row in rows}


def load_jobs(places):
    jobs = []
    for place_id, place in places.items():
        result_files = list((SEARCH_ROOT / place_id).glob("*/result.json"))
        if not result_files:
            continue
        result = json.loads(result_files[0].read_text(encoding="utf-8"))
        links = result.get("links", {}).get("internal", [])
        seen = set()
        for link in links:
            href = link.get("href", "")
            if "baidu.com/link?url=" not in href or href in seen:
                continue
            seen.add(href)
            jobs.append({"place": place, "url": href, "searchTitle": link.get("text", ""), "rank": len(seen)})
            if len(seen) >= MAX_PAGES_PER_PLACE:
                break
    return jobs


def markdown_text(result):
    markdown = getattr(result, "markdown", "")
    if isinstance(markdown, str):
        return markdown
    return getattr(markdown, "raw_markdown", "") or ""


async def download_candidates(session, record, result):
    if not record["identityMatched"]:
        return
    images = (getattr(result, "media", {}) or {}).get("images", [])
    place_dir = OUTPUT_ROOT / record["place"]["id"] / "images"
    place_dir.mkdir(parents=True, exist_ok=True)
    for image_index, media in enumerate(images):
        if len(record["images"]) >= MAX_IMAGES_PER_PLACE:
            break
        url = media.get("src") or media.get("url") or ""
        label = f"{media.get('alt', '')} {media.get('desc', '')}"
        if not url.startswith("http") or re.search(r"logo|avatar|icon|qrcode|favicon|loading", f"{url} {label}", re.I):
            continue
        try:
            async with session.get(url, headers={"Referer": record["finalUrl"], "User-Agent": "Mozilla/5.0"}, timeout=25) as response:
                if response.status != 200:
                    continue
                data = await response.read()
            with Image.open(BytesIO(data)) as source:
                width, height = source.size
                if min(width, height) < MIN_SHORT_SIDE:
                    continue
                destination = place_dir / f"p{record['rank']:02d}-i{image_index + 1:02d}-{hashlib.sha256(url.encode()).hexdigest()[:10]}.webp"
                source.convert("RGB").save(destination, "WEBP", quality=94, method=6)
            record["images"].append({
                "path": str(destination), "originalUrl": url, "width": width, "height": height,
                "alt": media.get("alt", ""), "desc": media.get("desc", ""),
            })
        except Exception:
            continue


async def main():
    places = load_places()
    jobs = load_jobs(places)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    run = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS, word_count_threshold=1, page_timeout=50000,
        wait_for_images=True, delay_before_return_html=1.5, scan_full_page=True,
        max_scroll_steps=5, simulate_user=True, override_navigator=True,
        remove_overlay_elements=True, semaphore_count=4,
    )
    browser = BrowserConfig(headless=True, enable_stealth=True, viewport_width=1440, viewport_height=1000)
    records = []
    async with AsyncWebCrawler(config=browser) as crawler, aiohttp.ClientSession() as session:
        resolved_jobs = []
        for job in jobs:
            try:
                async with session.get(job["url"], headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=False, timeout=15) as response:
                    location = response.headers.get("Location", "")
                if location:
                    job = {**job, "baiduRedirectUrl": job["url"], "url": urljoin(job["url"], location)}
            except Exception:
                pass
            resolved_jobs.append(job)
        jobs = resolved_jobs
        for start in range(0, len(jobs), 4):
            batch = jobs[start:start + 4]
            try:
                results = await crawler.arun_many([job["url"] for job in batch], config=run)
            except Exception as error:
                for job in batch:
                    records.append({**job, "success": False, "error": str(error), "images": []})
                continue
            for job, result in zip(batch, results):
                markdown = markdown_text(result)
                html = getattr(result, "html", "") or ""
                content = markdown
                record = {
                    **job,
                    "success": bool(getattr(result, "success", False)),
                    "statusCode": getattr(result, "status_code", 0),
                    "finalUrl": getattr(result, "url", job["url"]),
                    "identityMatched": bool(getattr(result, "success", False)) and identity_match(job["place"], content),
                    "error": getattr(result, "error_message", "") or "",
                    "images": [],
                }
                page_dir = OUTPUT_ROOT / job["place"]["id"] / f"page-{job['rank']:02d}"
                page_dir.mkdir(parents=True, exist_ok=True)
                (page_dir / "page.md").write_text(markdown, encoding="utf-8")
                (page_dir / "page.html").write_text(html, encoding="utf-8")
                await download_candidates(session, record, result)
                (page_dir / "result.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                records.append(record)
                print(json.dumps({"place": job["place"]["name"], "rank": job["rank"], "url": record["finalUrl"], "match": record["identityMatched"], "images": len(record["images"])}, ensure_ascii=False), flush=True)
    manifest = {"generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "jobs": len(jobs), "records": records}
    (OUTPUT_ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"jobs": len(jobs), "matched": sum(row.get("identityMatched", False) for row in records), "images": sum(len(row.get("images", [])) for row in records)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
