#!/usr/bin/env python3
"""Resolve and archive facility source pages discovered by Baidu searches."""

import argparse
import asyncio
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig, RateLimiter
from crawl4ai.async_dispatcher import MemoryAdaptiveDispatcher


FACILITY_TERMS = (
    "wifi", "无线", "插座", "电源", "充电", "厕所", "卫生间", "饮水", "热水",
    "茶水", "楼层", "存包", "储物柜", "打印", "复印", "电梯", "无障碍", "停车",
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-dir", default="data/research/facility-description-web-crawl-2026-08-09")
    parser.add_argument("--resolve-concurrency", type=int, default=4)
    parser.add_argument("--crawl-concurrency", type=int, default=3)
    parser.add_argument("--max-sources-per-place", type=int, default=4)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def load_candidates(research_dir):
    by_place = defaultdict(list)
    for batch_path in sorted(research_dir.glob("batch-*.json")):
        payload = json.loads(batch_path.read_text(encoding="utf-8"))
        for record in payload.get("records", []):
            for position, result in enumerate(record.get("searchResults", []), start=1):
                candidate = {
                    "id": record["id"],
                    "name": record["name"],
                    "category": record["category"],
                    "query": record["query"],
                    "variant": record["variant"],
                    "position": position,
                    **result,
                }
                if candidate.get("baiduRedirectUrl") or candidate.get("sourceUrl"):
                    by_place[record["id"]].append(candidate)
    deduped = []
    for candidates in by_place.values():
        seen = set()
        for candidate in candidates:
            url = candidate.get("sourceUrl") or candidate.get("baiduRedirectUrl")
            if url in seen:
                continue
            seen.add(url)
            deduped.append(candidate)
    return deduped


def infer_channel(url, title, snippet):
    text = f"{url} {title} {snippet}".lower()
    if "xiaohongshu" in text or "小红书" in text or "精选笔记" in text:
        return "小红书"
    if "dianping" in text or "大众点评" in text:
        return "大众点评"
    if "amap" in text or "高德" in text:
        return "高德"
    if "map.baidu" in text or "百度地图" in text:
        return "百度地图"
    domain = urlparse(url).netloc.lower()
    if domain.endswith("gov.cn") or "library" in domain or "图书馆" in title and "官网" in title:
        return "官方"
    if "baidu.com" in domain:
        return "百度"
    return domain.removeprefix("www.") or "其他网页"


async def resolve_candidates(candidates, concurrency):
    semaphore = asyncio.Semaphore(concurrency)
    timeout = aiohttp.ClientTimeout(total=35)
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36"}

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async def resolve(candidate):
            async with semaphore:
                resolved = dict(candidate)
                if candidate.get("sourceUrl"):
                    resolved["resolveStatus"] = 200
                    resolved["resolveError"] = ""
                    resolved["channel"] = infer_channel(
                        resolved["sourceUrl"], resolved.get("title", ""), resolved.get("snippet", "")
                    )
                    return resolved
                try:
                    async with session.get(candidate["baiduRedirectUrl"], allow_redirects=True) as response:
                        await response.content.read(512)
                        resolved["sourceUrl"] = str(response.url)
                        resolved["resolveStatus"] = response.status
                        resolved["resolveError"] = ""
                except Exception as error:  # Preserve failure evidence for later retries.
                    resolved["sourceUrl"] = ""
                    resolved["resolveStatus"] = 0
                    resolved["resolveError"] = str(error)
                resolved["channel"] = infer_channel(
                    resolved["sourceUrl"], resolved.get("title", ""), resolved.get("snippet", "")
                )
                print(json.dumps({
                    "id": resolved["id"],
                    "channel": resolved["channel"],
                    "resolved": bool(resolved["sourceUrl"]),
                }, ensure_ascii=False), flush=True)
                return resolved

        return await asyncio.gather(*(resolve(candidate) for candidate in candidates))


def source_score(candidate):
    url = candidate.get("sourceUrl", "")
    domain = urlparse(url).netloc.lower()
    text = f'{candidate.get("title", "")} {candidate.get("snippet", "")}'.lower()
    score = sum(term in text for term in FACILITY_TERMS) * 8
    if domain.endswith("gov.cn") or "library" in domain:
        score += 80
    if candidate.get("channel") in ("小红书", "大众点评"):
        score += 45
    if candidate.get("channel") in ("高德", "百度地图"):
        score += 25
    if "官方" in candidate.get("title", "") or "服务" in candidate.get("title", ""):
        score += 25
    if "zhidao.baidu.com" in url or "wenku.baidu.com" in url:
        score -= 40
    score -= candidate.get("position", 10)
    return score


def select_sources(resolved, max_per_place):
    by_place = defaultdict(list)
    for candidate in resolved:
        if candidate.get("sourceUrl") and candidate.get("hasFacilityTerm"):
            by_place[candidate["id"]].append(candidate)

    selected = []
    for candidates in by_place.values():
        ranked = sorted(candidates, key=source_score, reverse=True)
        picked_urls = set()
        picked_channels = set()
        for candidate in ranked:
            if len(picked_urls) >= max_per_place:
                break
            url = candidate["sourceUrl"]
            channel = candidate["channel"]
            if url in picked_urls or channel in picked_channels:
                continue
            selected.append(candidate)
            picked_urls.add(url)
            picked_channels.add(channel)
        for candidate in ranked:
            if len(picked_urls) >= max_per_place:
                break
            url = candidate["sourceUrl"]
            if url in picked_urls:
                continue
            selected.append(candidate)
            picked_urls.add(url)
    return selected


def markdown_text(result):
    markdown = result.markdown
    if markdown is None:
        return ""
    if hasattr(markdown, "raw_markdown"):
        return markdown.raw_markdown or ""
    return str(markdown)


async def crawl_sources(selected, research_dir, concurrency, refresh):
    raw_dir = research_dir / "raw-source-pages"
    raw_dir.mkdir(parents=True, exist_ok=True)
    unique = {}
    for candidate in selected:
        unique.setdefault(candidate["sourceUrl"], []).append(candidate)

    jobs = []
    for url, references in unique.items():
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
        raw_path = raw_dir / f"{digest}.md"
        if raw_path.exists() and raw_path.stat().st_size > 200 and not refresh:
            continue
        jobs.append({"url": url, "references": references, "rawPath": raw_path})

    url_to_job = {job["url"]: job for job in jobs}
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if refresh else CacheMode.ENABLED,
        stream=True,
        word_count_threshold=1,
    )
    dispatcher = MemoryAdaptiveDispatcher(
        memory_threshold_percent=75.0,
        check_interval=1.0,
        max_session_permit=concurrency,
        rate_limiter=RateLimiter(base_delay=(0.8, 1.8), max_delay=30.0, max_retries=2),
    )
    browser_config = BrowserConfig(headless=True, verbose=False)
    crawl_records = []

    async with AsyncWebCrawler(config=browser_config) as crawler:
        async for result in await crawler.arun_many(
            [job["url"] for job in jobs], config=run_config, dispatcher=dispatcher
        ):
            job = url_to_job.get(result.url)
            if job is None:
                continue
            markdown = markdown_text(result) if result.success else ""
            job["rawPath"].write_text(
                f'# Source URL\n\n{job["url"]}\n\n# Result\n\n{markdown}', encoding="utf-8"
            )
            crawl_records.append({
                "sourceUrl": job["url"],
                "success": bool(result.success),
                "statusCode": result.status_code,
                "error": result.error_message or "",
                "rawPath": str(job["rawPath"]),
                "placeIds": sorted({item["id"] for item in job["references"]}),
            })
            print(json.dumps({
                "sourceUrl": job["url"], "success": bool(result.success), "placeCount": len(crawl_records[-1]["placeIds"])
            }, ensure_ascii=False), flush=True)
    return crawl_records


async def main():
    args = parse_args()
    research_dir = Path(args.research_dir)
    candidates = load_candidates(research_dir)
    resolved_path = research_dir / "resolved-source-candidates.json"
    if resolved_path.exists() and not args.refresh:
        resolved = json.loads(resolved_path.read_text(encoding="utf-8"))["candidates"]
    else:
        resolved = await resolve_candidates(candidates, args.resolve_concurrency)
        resolved_path.write_text(json.dumps({
            "candidateCount": len(resolved), "candidates": resolved
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    selected = select_sources(resolved, args.max_sources_per_place)
    selected_path = research_dir / "selected-source-candidates.json"
    selected_path.write_text(json.dumps({
        "selectedCount": len(selected), "candidates": selected
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    crawled = await crawl_sources(selected, research_dir, args.crawl_concurrency, args.refresh)
    manifest_path = research_dir / "source-crawl-manifest.json"
    manifest_path.write_text(json.dumps({
        "selectedCount": len(selected), "uniqueCrawlCount": len(crawled), "records": crawled
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "resolved": len(resolved), "selected": len(selected), "crawled": len(crawled), "manifest": str(manifest_path)
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
