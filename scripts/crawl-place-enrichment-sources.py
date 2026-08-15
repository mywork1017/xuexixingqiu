#!/usr/bin/env python3
"""Select and fully archive source pages found by enrichment searches."""

import argparse
import asyncio
import hashlib
import importlib.util
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import aiohttp
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


FIELD_TERMS = (
    "地址", "开放时间", "营业时间", "服务时间", "wifi", "无线", "插座", "电源",
    "充电", "厕所", "卫生间", "饮水", "热水", "楼层", "电梯", "无障碍", "停车",
    "实景", "照片", "图片",
)
EXCLUDED_DOMAINS = (
    "baidu.com", "sogou.com", "google.com", "bing.com", "miit.gov.cn",
    "fankui.sogou.com", "yuanbao.tencent.com",
)
TRACKING_KEYS = {
    "src", "timestamp", "ver", "signature", "from", "source", "utm_source",
    "utm_medium", "utm_campaign", "utm_content", "utm_term",
}
BAIDU_RESULT = re.compile(
    r"^### \[(.+?)\]\((https?://(?:www\.)?baidu\.com/link\?url=[^)]+)\)\s*$"
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--research-dir",
        default="data/research/place-enrichment-web-crawl-2026-08-09",
    )
    parser.add_argument("--max-sources-per-place", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def load_archive_helpers():
    path = Path(__file__).with_name("crawl-place-enrichment.py")
    spec = importlib.util.spec_from_file_location("place_enrichment_archive", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize_text(value):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value).lower())


def normalize_source_url(value):
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    query = [(key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True)
             if key.lower() not in TRACKING_KEYS]
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path, "", urlencode(query), ""))


def source_score(place, link):
    href = link.get("href", "")
    text = f'{link.get("text", "")} {link.get("title", "")}'
    normalized = normalize_text(text)
    place_name = normalize_text(place["name"])
    place_flat = normalize_text(re.sub(r"[（）()]", "", place["name"]))
    domain = urlparse(href).netloc.lower()
    score = sum(term in text.lower() for term in FIELD_TERMS) * 9
    if place_name and place_name in normalized:
        score += 90
    elif place_flat and place_flat in normalized:
        score += 70
    elif normalize_text(re.sub(r"[（(].*?[）)]", "", place["name"])) in normalized:
        score += 30
    if domain.endswith("gov.cn") or ".gov.cn" in domain:
        score += 100
    if "library" in domain or domain.endswith("sh.cn"):
        score += 70
    if any(value in domain for value in ("xiaohongshu", "dianping", "weibo", "amap", "map.qq")):
        score += 55
    if "mp.weixin.qq.com" in domain:
        score += 45
    if any(value in domain for value in ("thepaper", "shobserver", "xinmin", "163.com")):
        score += 30
    if not normalized:
        score -= 80
    return score


def clean_markdown(value):
    value = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"[#_*|`]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def baidu_markdown_candidates(path, place):
    markdown_path = path.parent / "raw.md"
    if not markdown_path.is_file():
        markdown_path = path.parent / "raw_markdown.md"
    if not markdown_path.is_file():
        return []
    lines = markdown_path.read_text(encoding="utf-8", errors="replace").splitlines()
    candidates = []
    for index, line in enumerate(lines):
        match = BAIDU_RESULT.match(line.strip())
        if not match:
            continue
        title = clean_markdown(match.group(1))
        snippet_lines = []
        for following in lines[index + 1:index + 9]:
            if following.startswith("### "):
                break
            cleaned = clean_markdown(following)
            if cleaned and not cleaned.startswith(("http://", "https://")):
                snippet_lines.append(cleaned)
        redirect_url = match.group(2).replace("http://", "https://", 1)
        candidate = {
            "place": place,
            "sourceUrl": redirect_url,
            "baiduRedirectUrl": redirect_url,
            "text": f"{title} {' '.join(snippet_lines)}".strip(),
            "title": title,
            "baseDomain": "baidu.com",
            "linkType": "baiduMarkdownResult",
            "position": len(candidates) + 1,
            "discoveredFrom": str(path),
        }
        candidate["score"] = source_score(
            place,
            {"href": redirect_url, "text": candidate["text"], "title": title},
        ) - candidate["position"]
        if candidate["score"] >= 25:
            candidates.append(candidate)
    return candidates


def collect_candidates(research_dir, request_key):
    by_place = defaultdict(list)
    for path in sorted((research_dir / "pages" / "search").glob("**/result.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        requested_url = record.get("requestedUrl", "")
        result_url = record.get("resultUrl", "")
        if requested_url and result_url:
            try:
                if request_key(requested_url) != request_key(result_url):
                    continue
            except Exception:
                continue
        place = record.get("place") or {}
        if not place.get("id"):
            continue
        if record.get("channel") == "baidu":
            by_place[place["id"]].extend(baidu_markdown_candidates(path, place))
        for link_type, links in (record.get("links") or {}).items():
            for position, link in enumerate(links or [], start=1):
                href = normalize_source_url(link.get("href", ""))
                domain = urlparse(href).netloc.lower()
                if not href or any(domain == item or domain.endswith(f".{item}") for item in EXCLUDED_DOMAINS):
                    continue
                candidate = {
                    "place": place,
                    "sourceUrl": href,
                    "text": link.get("text", ""),
                    "title": link.get("title", ""),
                    "baseDomain": link.get("base_domain", ""),
                    "linkType": link_type,
                    "position": position,
                    "discoveredFrom": str(path),
                }
                candidate["score"] = source_score(place, {**link, "href": href}) - position
                if candidate["score"] >= 25:
                    by_place[place["id"]].append(candidate)
    return by_place


async def resolve_baidu_redirects(by_place, research_dir):
    resolution_path = research_dir / "baidu-redirect-resolution.json"
    cached = {}
    if resolution_path.is_file():
        payload = json.loads(resolution_path.read_text(encoding="utf-8"))
        cached = {item["redirectUrl"]: item for item in payload.get("resolutions", [])}
    redirects = sorted({
        candidate["baiduRedirectUrl"]
        for candidates in by_place.values()
        for candidate in candidates
        if candidate.get("baiduRedirectUrl") and candidate["baiduRedirectUrl"] not in cached
    })
    semaphore = asyncio.Semaphore(8)
    timeout = aiohttp.ClientTimeout(total=35)
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/127 Safari/537.36",
    }
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async def resolve(url):
            async with semaphore:
                item = {"redirectUrl": url, "resolvedUrl": "", "statusCode": 0, "error": ""}
                try:
                    async with session.get(url, allow_redirects=True) as response:
                        await response.content.read(1024)
                        item["resolvedUrl"] = str(response.url)
                        item["statusCode"] = response.status
                except Exception as error:
                    item["error"] = str(error)
                print(json.dumps({
                    "redirect": url,
                    "resolved": bool(item["resolvedUrl"]),
                    "status": item["statusCode"],
                }, ensure_ascii=False), flush=True)
                return item

        for start in range(0, len(redirects), 80):
            resolved = await asyncio.gather(*(resolve(url) for url in redirects[start:start + 80]))
            cached.update({item["redirectUrl"]: item for item in resolved})
            resolution_path.write_text(json.dumps({
                "resolutionCount": len(cached),
                "resolutions": [cached[url] for url in sorted(cached)],
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    resolved_by_place = defaultdict(list)
    for place_id, candidates in by_place.items():
        for candidate in candidates:
            if candidate.get("baiduRedirectUrl"):
                resolution = cached.get(candidate["baiduRedirectUrl"], {})
                source_url = normalize_source_url(resolution.get("resolvedUrl", ""))
                if not source_url:
                    continue
                domain = urlparse(source_url).netloc.lower()
                if any(domain == item or domain.endswith(f".{item}") for item in EXCLUDED_DOMAINS):
                    continue
                candidate = {
                    **candidate,
                    "sourceUrl": source_url,
                    "resolveStatus": resolution.get("statusCode", 0),
                    "resolveError": resolution.get("error", ""),
                }
            resolved_by_place[place_id].append(candidate)
    return resolved_by_place


def select_candidates(by_place, max_per_place):
    selected = []
    for candidates in by_place.values():
        best_by_url = {}
        for candidate in candidates:
            url = candidate["sourceUrl"]
            if url not in best_by_url or candidate["score"] > best_by_url[url]["score"]:
                best_by_url[url] = candidate
        ranked = sorted(best_by_url.values(), key=lambda item: (-item["score"], item["sourceUrl"]))
        picked = []
        domains = defaultdict(int)
        for candidate in ranked:
            domain = urlparse(candidate["sourceUrl"]).netloc.lower().removeprefix("www.")
            if domains[domain] >= 2:
                continue
            picked.append(candidate)
            domains[domain] += 1
            if len(picked) >= max_per_place:
                break
        selected.extend(picked)
    return selected


async def crawl_sources(args):
    helpers = load_archive_helpers()
    research_dir = Path(args.research_dir)
    candidates = collect_candidates(research_dir, helpers.request_key)
    candidates = await resolve_baidu_redirects(candidates, research_dir)
    selected = select_candidates(candidates, args.max_sources_per_place)
    candidate_path = research_dir / "source-candidates.json"
    candidate_path.write_text(json.dumps({
        "selectedCount": len(selected),
        "candidates": selected,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    by_url = defaultdict(list)
    for candidate in selected:
        by_url[candidate["sourceUrl"]].append(candidate)
    jobs = []
    for url, references in sorted(by_url.items()):
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
        bundle_dir = research_dir / "pages" / "sources" / digest
        if (bundle_dir / "result.json").exists() and not args.refresh:
            continue
        jobs.append({
            "place": {
                "id": references[0]["place"]["id"],
                "name": references[0]["place"]["name"],
                "category": references[0]["place"]["category"],
                "references": sorted({item["place"]["id"] for item in references}),
            },
            "phase": "sources",
            "channel": urlparse(url).netloc.lower().removeprefix("www."),
            "query": "",
            "url": url,
            "bundleDir": bundle_dir,
        })

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=1,
        page_timeout=60000,
        wait_for_images=True,
        delay_before_return_html=0.4,
        scan_full_page=True,
        max_scroll_steps=8,
        process_iframes=True,
        remove_overlay_elements=True,
        remove_consent_popups=True,
        override_navigator=True,
        capture_network_requests=True,
        semaphore_count=max(1, min(args.batch_size, 4)),
    )
    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        enable_stealth=True,
        viewport_width=1280,
        viewport_height=900,
        max_pages_before_recycle=60,
    )
    records = []
    async with AsyncWebCrawler(config=browser_config) as crawler:
        for start in range(0, len(jobs), args.batch_size):
            batch = jobs[start:start + args.batch_size]
            try:
                results = await crawler.arun_many(
                    [job["url"] for job in batch], config=run_config
                )
            except Exception as error:
                for job in batch:
                    records.append(helpers.save_exception(job["bundleDir"], job, error))
                continue
            jobs_by_key = {}
            for job in batch:
                jobs_by_key.setdefault(helpers.request_key(job["url"]), []).append(job)
            unmatched = []
            for result in results:
                candidates = jobs_by_key.get(helpers.request_key(result.url), [])
                if not candidates:
                    unmatched.append(result)
                    continue
                job = candidates.pop(0)
                record = helpers.save_result(job["bundleDir"], job, result)
                records.append(record)
                print(json.dumps({
                    "url": job["url"],
                    "success": record["success"],
                    "status": record["statusCode"],
                    "places": len(job["place"]["references"]),
                    "text": record["fileLengths"].get("raw_markdown", record["fileLengths"].get("raw", 0)),
                    "images": len(record["media"].get("images", [])),
                }, ensure_ascii=False), flush=True)
            for result in unmatched:
                print(json.dumps({"mappingError": True, "resultUrl": result.url}, ensure_ascii=False), flush=True)
            for remaining in jobs_by_key.values():
                for job in remaining:
                    records.append(helpers.save_exception(
                        job["bundleDir"], job,
                        f"Crawl4AI returned no result matching requested URL: {job['url']}",
                    ))

    index_path = research_dir / "source-crawl-index.json"
    index_path.write_text(json.dumps({
        "candidateCount": len(selected),
        "uniqueSourceCount": len(by_url),
        "scheduledCount": len(jobs),
        "savedCount": len(records),
        "sources": [{
            "sourceUrl": url,
            "placeIds": sorted({item["place"]["id"] for item in refs}),
            "bundleDir": str(research_dir / "pages" / "sources" / hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]),
        } for url, refs in sorted(by_url.items())],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "selected": len(selected),
        "uniqueSources": len(by_url),
        "scheduled": len(jobs),
        "saved": len(records),
        "index": str(index_path),
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(crawl_sources(parse_args()))
