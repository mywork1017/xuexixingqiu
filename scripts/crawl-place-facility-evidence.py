#!/usr/bin/env python3
"""Crawl fresh public-web facility evidence for place descriptions.

This script only gathers source material. It never generates or writes Place.description.
"""

import argparse
import asyncio
import json
import re
import sqlite3
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig, RateLimiter
from crawl4ai.async_dispatcher import MemoryAdaptiveDispatcher


FACILITY_TERMS = (
    "WiFi", "wifi", "Wi-Fi", "无线", "插座", "电源", "充电", "厕所", "卫生间",
    "饮水", "热水", "茶水", "楼层", "几楼", "一楼", "二楼", "三楼", "四楼",
    "五楼", "六楼", "七楼", "八楼", "九楼", "十楼", "地下一层", "B1", "F1",
    "存包", "储物柜", "打印", "复印", "电梯", "无障碍", "停车", "母婴", "空调",
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument(
        "--output-dir",
        default="data/research/facility-description-web-crawl-2026-08-09",
    )
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--category", choices=("图书馆", "食堂"))
    parser.add_argument("--mode", choices=("base", "channels"), default="base")
    parser.add_argument(
        "--engine",
        choices=("baidu-desktop", "baidu-mobile", "duckduckgo"),
        default="baidu-desktop",
    )
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def load_places(database_path, category, offset, limit):
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        query = "SELECT id, name, category FROM Place"
        params = []
        if category:
            query += " WHERE category = ?"
            params.append(category)
        query += " ORDER BY rowid LIMIT ? OFFSET ?"
        params.extend((limit if limit > 0 else -1, offset))
        return [dict(row) for row in connection.execute(query, params)]


def build_queries(place, mode):
    name = place["name"]
    if mode == "channels":
        return [
            f'{name} 小红书 大众点评 WiFi 插座 厕所 饮水 设施',
            f'{name} 官方 高德 百度地图 服务 楼层 电梯 无障碍 停车 热水',
        ]
    if place["category"] == "食堂":
        return [
            f'"{name}" WiFi 插座 电源 充电',
            f'"{name}" 厕所 饮水 热水 茶水 楼层',
        ]
    return [
        f'"{name}" WiFi 无线网 插座 电源 充电',
        f'"{name}" 厕所 饮水机 热水 楼层 存包',
    ]


def markdown_text(result):
    markdown = result.markdown
    if markdown is None:
        return ""
    if hasattr(markdown, "raw_markdown"):
        return markdown.raw_markdown or ""
    return str(markdown)


def compact_excerpt(markdown, place_name):
    lines = [re.sub(r"\s+", " ", line).strip() for line in markdown.splitlines()]
    selected = []
    for index, line in enumerate(lines):
        if not line:
            continue
        has_facility = any(term.lower() in line.lower() for term in FACILITY_TERMS)
        has_name = place_name in line
        if not has_facility and not has_name:
            continue
        start = max(0, index - 1)
        end = min(len(lines), index + 2)
        block = " ".join(item for item in lines[start:end] if item)
        if block and block not in selected:
            selected.append(block[:1800])
        if len(selected) >= 30:
            break
    return selected


def extract_search_results(markdown, place_name):
    """Keep Baidu result headings, source links and nearby snippets."""
    lines = markdown.splitlines()
    results = []
    heading_pattern = re.compile(r"^### \[(.+?)\]\((https?://www\.baidu\.com/link\?url=[^)]+)\)\s*$")
    for index, line in enumerate(lines):
        match = heading_pattern.match(line.strip())
        if not match:
            continue
        title = re.sub(r"[_*]", "", match.group(1)).strip()
        snippet_lines = []
        for following in lines[index + 1:index + 7]:
            following = following.strip()
            if following.startswith("### "):
                break
            if following and not following.startswith("[!["):
                snippet_lines.append(following)
        snippet = re.sub(r"\s+", " ", " ".join(snippet_lines)).strip()
        combined = f"{title} {snippet}"
        if place_name not in combined and re.sub(r"[（）()]", "", place_name) not in re.sub(r"[（）()]", "", combined):
            continue
        results.append({
            "title": title,
            "baiduRedirectUrl": match.group(2),
            "snippet": snippet[:3000],
            "hasFacilityTerm": any(term.lower() in combined.lower() for term in FACILITY_TERMS),
        })
        if len(results) >= 12:
            break
    return results


def extract_duckduckgo_results(markdown, place_name):
    lines = markdown.splitlines()
    results = []
    heading_pattern = re.compile(r"^##\s+\[(.+?)\]\((https?://duckduckgo\.com/l/\?[^)]+)\)\s*$")
    normalized_name = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", place_name.lower())
    normalized_short_name = re.sub(
        r"[^0-9a-z\u4e00-\u9fff]+", "", re.sub(r"[（(].*?[）)]", "", place_name).lower()
    )
    for index, line in enumerate(lines):
        match = heading_pattern.match(line.strip())
        if not match:
            continue
        title = re.sub(r"[_*]", "", match.group(1)).strip()
        redirect_url = match.group(2).replace("&amp;", "&")
        source_url = parse_qs(urlparse(redirect_url).query).get("uddg", [""])[0]
        snippet_lines = []
        for following in lines[index + 1:index + 5]:
            following = following.strip()
            if following.startswith("## "):
                break
            if following and not following.startswith("[ !["):
                snippet_lines.append(following)
        snippet = re.sub(r"\s+", " ", " ".join(snippet_lines)).strip()
        combined = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", f"{title}{snippet}".lower())
        if normalized_name not in combined and normalized_short_name not in combined:
            continue
        text = f"{title} {snippet}"
        results.append({
            "title": title,
            "sourceUrl": source_url,
            "searchRedirectUrl": redirect_url,
            "snippet": snippet[:3000],
            "hasFacilityTerm": any(term.lower() in text.lower() for term in FACILITY_TERMS),
        })
        if len(results) >= 12:
            break
    return results


async def crawl(args):
    output_dir = Path(args.output_dir)
    raw_dir = output_dir / "raw-search-pages"
    raw_dir.mkdir(parents=True, exist_ok=True)
    places = load_places(args.database, args.category, args.offset, args.limit)

    jobs = []
    for place in places:
        for variant, query in enumerate(build_queries(place, args.mode), start=1):
            suffix_parts = []
            if args.mode != "base":
                suffix_parts.append(args.mode)
            if args.engine == "baidu-mobile":
                suffix_parts.append("mobile")
            elif args.engine == "duckduckgo":
                suffix_parts.append("duckduckgo")
            mode_suffix = f"-{'-'.join(suffix_parts)}" if suffix_parts else ""
            raw_path = raw_dir / f'{place["id"]}{mode_suffix}-{variant}.md'
            if raw_path.exists() and raw_path.stat().st_size > 100 and not args.refresh:
                continue
            if args.engine == "baidu-mobile":
                url = f"https://m.baidu.com/s?word={quote_plus(query)}"
            elif args.engine == "duckduckgo":
                url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            else:
                url = f"https://www.baidu.com/s?wd={quote_plus(query)}"
            jobs.append({"place": place, "variant": variant, "query": query, "url": url, "raw_path": raw_path})

    url_to_job = {job["url"]: job for job in jobs}
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if args.refresh else CacheMode.ENABLED,
        stream=True,
        word_count_threshold=1,
    )
    dispatcher = MemoryAdaptiveDispatcher(
        memory_threshold_percent=75.0,
        check_interval=1.0,
        max_session_permit=args.concurrency,
        rate_limiter=RateLimiter(
            base_delay=(0.8, 1.8),
            max_delay=30.0,
            max_retries=3,
            rate_limit_codes=[403, 429, 503],
        ),
    )
    browser_config = BrowserConfig(headless=True, verbose=False)
    records = []

    async with AsyncWebCrawler(config=browser_config) as crawler:
        async for result in await crawler.arun_many(
            [job["url"] for job in jobs],
            config=run_config,
            dispatcher=dispatcher,
        ):
            job = url_to_job.get(result.url)
            if job is None:
                continue
            markdown = markdown_text(result) if result.success else ""
            job["raw_path"].write_text(
                f'# Query\n\n{job["query"]}\n\n# Search URL\n\n{job["url"]}\n\n# Result\n\n{markdown}',
                encoding="utf-8",
            )
            records.append({
                "id": job["place"]["id"],
                "name": job["place"]["name"],
                "category": job["place"]["category"],
                "variant": job["variant"],
                "query": job["query"],
                "searchUrl": job["url"],
                "success": bool(result.success),
                "statusCode": result.status_code,
                "error": result.error_message or "",
                "facilityExcerpt": compact_excerpt(markdown, job["place"]["name"]),
                "searchResults": (
                    extract_duckduckgo_results(markdown, job["place"]["name"])
                    if args.engine == "duckduckgo"
                    else extract_search_results(markdown, job["place"]["name"])
                ),
                "rawPath": str(job["raw_path"]),
            })
            print(json.dumps({
                "id": job["place"]["id"],
                "variant": job["variant"],
                "success": bool(result.success),
                "excerptCount": len(records[-1]["facilityExcerpt"]),
            }, ensure_ascii=False), flush=True)

    engine_prefix = {
        "baidu-desktop": "",
        "baidu-mobile": "mobile-",
        "duckduckgo": "duckduckgo-",
    }[args.engine]
    mode_prefix = "" if args.mode == "base" else f"{args.mode}-"
    batch_path = output_dir / f"batch-{engine_prefix}{mode_prefix}{args.category or 'all'}-{args.offset}-{len(places)}.json"
    batch_path.write_text(json.dumps({
        "placeCount": len(places),
        "crawlCount": len(records),
        "records": sorted(records, key=lambda item: (item["id"], item["variant"])),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"batchPath": str(batch_path), "places": len(places), "crawled": len(records)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(crawl(parse_args()))
