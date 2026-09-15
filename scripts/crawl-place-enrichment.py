#!/usr/bin/env python3
"""Archive full Crawl4AI results for multi-channel place enrichment research."""

import argparse
import asyncio
import hashlib
import json
import os
import re
import sqlite3
from pathlib import Path
from urllib.parse import parse_qsl, quote_plus, urlsplit

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


DEFAULT_RESEARCH_DIR = "data/research/place-enrichment-web-crawl-2026-08-09"
SEARCH_CHANNELS = ("baidu", "sogou", "weixin")
PLATFORM_CHANNELS = ("google", "xiaohongshu", "dianping", "amap", "qqmap", "weibo")
ARCHIVE_SCHEMA_VERSION = "v3-url-mapped-fresh"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument("--research-dir", default=DEFAULT_RESEARCH_DIR)
    parser.add_argument("--phase", choices=("search", "platforms"), required=True)
    parser.add_argument("--channels", default="")
    parser.add_argument("--category", choices=("图书馆", "食堂", "自然"))
    parser.add_argument("--city", choices=("上海", "苏州", "嘉兴", "南通", "无锡", "镇江"))
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--attempt-tag", default="initial")
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def load_places(database, category, city, offset, limit):
    query = "SELECT id, name, category, address, latitude, longitude FROM Place"
    params = []
    conditions = []
    if category:
        conditions.append("category = ?")
        params.append(category)
    if city == "上海":
        conditions.append("address LIKE '上海市%'")
    elif city == "苏州":
        conditions.append("(address LIKE '苏州市%' OR address LIKE '苏州高新区%')")
    elif city in ("嘉兴", "南通", "无锡", "镇江"):
        conditions.append("address LIKE ?")
        params.append(f"{city}市%")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY rowid LIMIT ? OFFSET ?"
    params.extend((limit if limit > 0 else -1, offset))
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        rows = [dict(row) for row in connection.execute(query, params)]
    requested_ids = {item for item in os.environ.get("PLACE_IDS", "").split(",") if item}
    return [row for row in rows if not requested_ids or row["id"] in requested_ids]


def search_name(name):
    value = re.sub(r"[（）()]", " ", name).replace("“", "").replace("”", "")
    return re.sub(r"\s+", " ", value).strip()


def rich_query(place):
    name = search_name(place["name"])
    if place["category"] == "食堂":
        return f'"{name}" 地址 营业时间 厕所 饮水 电梯 无障碍 图片 实景 小红书 大众点评'
    if place["category"] == "自然":
        return f'"{name}" 地址 开放时间 入口 步道 草坪 亲水 厕所 无障碍 停车 图片 实景 小红书 大众点评'
    return f'"{name}" 地址 开放时间 WiFi 插座 厕所 饮水 电梯 无障碍 停车 图片 实景 小红书 大众点评'


def channel_url(channel, place):
    name = search_name(place["name"])
    query = rich_query(place)
    if channel == "baidu":
        return f"https://www.baidu.com/s?wd={quote_plus(query)}", query
    if channel == "sogou":
        return f"https://www.sogou.com/web?query={quote_plus(query)}", query
    if channel == "weixin":
        weixin_query = f"{name} 地址 开放时间 营业时间 设施"
        return f"https://weixin.sogou.com/weixin?type=2&query={quote_plus(weixin_query)}", weixin_query
    if channel == "google":
        return f"https://www.google.com/search?q={quote_plus(query)}", query
    if channel == "xiaohongshu":
        return f"https://www.xiaohongshu.com/search_result?keyword={quote_plus(name)}", name
    if channel == "dianping":
        return f"https://www.dianping.com/search/keyword/1/0_{quote_plus(name)}", name
    if channel == "amap":
        return f"https://www.amap.com/search?query={quote_plus(name)}", name
    if channel == "qqmap":
        return f"https://map.qq.com/?type=poi&what={quote_plus(name)}", name
    if channel == "weibo":
        return f"https://s.weibo.com/weibo?q={quote_plus(name)}", name
    raise ValueError(f"unsupported channel: {channel}")


def markdown_parts(result):
    markdown = result.markdown
    if markdown is None:
        return {}
    if isinstance(markdown, str):
        return {"raw": markdown}
    parts = {}
    for key in (
        "raw_markdown",
        "markdown_with_citations",
        "references_markdown",
        "fit_markdown",
        "fit_html",
    ):
        value = getattr(markdown, key, None)
        if isinstance(value, str) and value:
            parts[key] = value
    return parts


def json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def request_key(url):
    parsed = urlsplit(url)
    return (
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        parsed.path.rstrip("/"),
        tuple(sorted(parse_qsl(parsed.query, keep_blank_values=True))),
    )


def save_result(bundle_dir, job, result):
    bundle_dir.mkdir(parents=True, exist_ok=True)
    raw_html = getattr(result, "html", "") or ""
    cleaned_html = getattr(result, "cleaned_html", "") or ""
    fit_html = getattr(result, "fit_html", "") or ""
    (bundle_dir / "raw.html").write_text(raw_html, encoding="utf-8")
    (bundle_dir / "cleaned.html").write_text(cleaned_html, encoding="utf-8")
    if isinstance(fit_html, str) and fit_html:
        (bundle_dir / "fit.html").write_text(fit_html, encoding="utf-8")
    markdown = markdown_parts(result)
    for key, value in markdown.items():
        suffix = "md" if key != "fit_html" else "html"
        (bundle_dir / f"{key}.{suffix}").write_text(value, encoding="utf-8")
    extracted_content = getattr(result, "extracted_content", "") or ""
    if isinstance(extracted_content, str) and extracted_content:
        (bundle_dir / "extracted-content.txt").write_text(
            extracted_content, encoding="utf-8"
        )
    payload = {
        "place": job["place"],
        "phase": job["phase"],
        "channel": job["channel"],
        "attemptTag": job.get("attemptTag", ""),
        "bundleDir": str(bundle_dir),
        "query": job["query"],
        "requestedUrl": job["url"],
        "resultUrl": getattr(result, "url", job["url"]),
        "redirectedUrl": getattr(result, "redirected_url", ""),
        "redirectedStatusCode": getattr(result, "redirected_status_code", 0),
        "success": bool(getattr(result, "success", False)),
        "statusCode": getattr(result, "status_code", 0),
        "error": getattr(result, "error_message", "") or "",
        "metadata": json_safe(getattr(result, "metadata", {}) or {}),
        "links": json_safe(getattr(result, "links", {}) or {}),
        "media": json_safe(getattr(result, "media", {}) or {}),
        "downloadedFiles": json_safe(getattr(result, "downloaded_files", []) or []),
        "responseHeaders": json_safe(getattr(result, "response_headers", {}) or {}),
        "networkRequests": json_safe(getattr(result, "network_requests", []) or []),
        "consoleMessages": json_safe(getattr(result, "console_messages", []) or []),
        "tables": json_safe(getattr(result, "tables", []) or []),
        "cacheStatus": str(getattr(result, "cache_status", "") or ""),
        "crawlStats": json_safe(getattr(result, "crawl_stats", {}) or {}),
        "fileLengths": {
            "rawHtml": len(raw_html),
            "cleanedHtml": len(cleaned_html),
            **{key: len(value) for key, value in markdown.items()},
        },
    }
    (bundle_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def save_exception(bundle_dir, job, error):
    bundle_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "place": job["place"],
        "phase": job["phase"],
        "channel": job["channel"],
        "attemptTag": job.get("attemptTag", ""),
        "bundleDir": str(bundle_dir),
        "query": job["query"],
        "requestedUrl": job["url"],
        "success": False,
        "statusCode": 0,
        "error": str(error),
        "metadata": {},
        "links": {},
        "media": {},
    }
    (bundle_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


async def crawl(args):
    research_dir = Path(args.research_dir)
    channels = tuple(
        item.strip() for item in args.channels.split(",") if item.strip()
    ) or (SEARCH_CHANNELS if args.phase == "search" else PLATFORM_CHANNELS)
    allowed = set(SEARCH_CHANNELS if args.phase == "search" else PLATFORM_CHANNELS)
    if not channels or any(channel not in allowed for channel in channels):
        raise ValueError(f"channels for {args.phase} must come from {sorted(allowed)}")
    places = load_places(args.database, args.category, args.city, args.offset, args.limit)
    jobs = []
    for place in places:
        for channel in channels:
            url, query = channel_url(channel, place)
            attempt_key = hashlib.sha256(
                f"{ARCHIVE_SCHEMA_VERSION}\n{args.attempt_tag}\n{query}\n{url}".encode("utf-8")
            ).hexdigest()[:12]
            bundle_dir = research_dir / "pages" / args.phase / channel / place["id"] / attempt_key
            if (bundle_dir / "result.json").exists() and not args.refresh:
                continue
            jobs.append({
                "place": place,
                "phase": args.phase,
                "channel": channel,
                "attemptTag": args.attempt_tag,
                "query": query,
                "url": url,
                "bundleDir": bundle_dir,
            })

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=1,
        page_timeout=45000,
        wait_for_images=True,
        delay_before_return_html=0.5 if args.phase == "platforms" else 0.2,
        mean_delay=0.9 if args.phase == "search" else 0.5,
        max_range=0.8 if args.phase == "search" else 0.5,
        scan_full_page=args.phase == "platforms",
        max_scroll_steps=6,
        simulate_user=args.phase == "platforms",
        override_navigator=True,
        magic=args.phase == "platforms",
        capture_network_requests=args.phase == "platforms",
        capture_console_messages=args.phase == "platforms",
        semaphore_count=max(1, min(args.batch_size, 4)),
    )
    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        enable_stealth=True,
        viewport_width=1280,
        viewport_height=900,
    )
    records = []
    async with AsyncWebCrawler(config=browser_config) as crawler:
        for start in range(0, len(jobs), args.batch_size):
            batch = jobs[start:start + args.batch_size]
            try:
                results = await crawler.arun_many(
                    [job["url"] for job in batch],
                    config=run_config,
                )
            except Exception as error:
                for job in batch:
                    records.append(save_exception(job["bundleDir"], job, error))
                continue
            jobs_by_key = {}
            for job in batch:
                jobs_by_key.setdefault(request_key(job["url"]), []).append(job)
            unmatched = []
            for result in results:
                candidates = jobs_by_key.get(request_key(result.url), [])
                if not candidates:
                    unmatched.append(result)
                    continue
                job = candidates.pop(0)
                record = save_result(job["bundleDir"], job, result)
                records.append(record)
                print(json.dumps({
                    "id": job["place"]["id"],
                    "channel": job["channel"],
                    "success": record["success"],
                    "status": record["statusCode"],
                    "html": record["fileLengths"]["rawHtml"],
                    "images": len(record["media"].get("images", [])),
                }, ensure_ascii=False), flush=True)
            for result in unmatched:
                print(json.dumps({
                    "mappingError": True,
                    "resultUrl": result.url,
                    "batchUrls": [job["url"] for job in batch],
                }, ensure_ascii=False), flush=True)
            for remaining in jobs_by_key.values():
                for job in remaining:
                    records.append(save_exception(
                        job["bundleDir"], job,
                        f"Crawl4AI returned no result matching requested URL: {job['url']}",
                    ))

    manifest_dir = research_dir / "manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / (
        f"{args.phase}-{','.join(channels)}-{args.attempt_tag}-{args.category or 'all'}-"
        f"{args.city or 'all-cities'}-{args.offset}-{len(places)}.json"
    )
    manifest_path.write_text(json.dumps({
        "phase": args.phase,
        "channels": channels,
        "attemptTag": args.attempt_tag,
        "city": args.city,
        "placeCount": len(places),
        "scheduledCount": len(jobs),
        "savedCount": len(records),
        "records": [{
            "id": record["place"]["id"],
            "channel": record["channel"],
            "success": record["success"],
            "statusCode": record["statusCode"],
            "error": record["error"],
            "bundleDir": str(record.get("bundleDir", "")),
        } for record in records],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest_path),
        "places": len(places),
        "scheduled": len(jobs),
        "saved": len(records),
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(crawl(parse_args()))
