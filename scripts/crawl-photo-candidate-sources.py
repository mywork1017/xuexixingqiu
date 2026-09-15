#!/usr/bin/env python3
"""Archive full source pages for prepared photo candidates with Crawl4AI."""

import argparse
import asyncio
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="append", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--batch-size", type=int, default=6)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def normalize(value):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value).lower())


def request_key(url):
    parsed = urlsplit(url)
    return parsed.netloc.lower(), parsed.path.rstrip("/"), parsed.query


def load_jobs(report_paths, output_dir, refresh):
    by_url = {}
    for report_path in report_paths:
        report = json.loads(Path(report_path).read_text(encoding="utf-8"))
        for image in report.get("images", []):
            url = image.get("sourcePage", "")
            if not url.startswith(("http://", "https://")):
                continue
            by_url.setdefault(url, []).append({
                "placeId": image["placeId"],
                "placeName": image["placeName"],
                "imageId": image["id"],
                "sourceUrl": image["sourceUrl"],
                "title": image.get("title", ""),
            })
    jobs = []
    for url, images in by_url.items():
        digest = hashlib.sha256(url.encode()).hexdigest()[:16]
        bundle = output_dir / digest
        if refresh or not (bundle / "result.json").is_file():
            jobs.append({"url": url, "images": images, "bundle": bundle})
    return jobs, by_url


def save(job, result):
    job["bundle"].mkdir(parents=True, exist_ok=True)
    html = result.html or ""
    markdown = str(result.markdown or "")
    (job["bundle"] / "raw.html").write_text(html, encoding="utf-8")
    (job["bundle"] / "raw.md").write_text(markdown, encoding="utf-8")
    normalized = normalize(f"{result.url} {result.metadata or {}} {markdown} {html}")
    identities = []
    for image in job["images"]:
        name = normalize(image["placeName"])
        identities.append({
            **image,
            "placeNameFound": bool(name and name in normalized),
        })
    payload = {
        "requestedUrl": job["url"],
        "resultUrl": result.url,
        "success": bool(result.success),
        "statusCode": result.status_code,
        "error": result.error_message or "",
        "metadata": result.metadata or {},
        "images": identities,
    }
    (job["bundle"] / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return payload


async def crawl(args):
    output_dir = Path(args.output_dir)
    jobs, by_url = load_jobs(args.report, output_dir, args.refresh)
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=1,
        page_timeout=50000,
        wait_for_images=True,
        delay_before_return_html=0.8,
        scan_full_page=True,
        max_scroll_steps=4,
        simulate_user=True,
        override_navigator=True,
        remove_overlay_elements=True,
        semaphore_count=max(1, min(args.batch_size, 4)),
    )
    browser = BrowserConfig(
        headless=True,
        verbose=False,
        enable_stealth=True,
        viewport_width=1440,
        viewport_height=1000,
    )
    records = []
    async with AsyncWebCrawler(config=browser) as crawler:
        for start in range(0, len(jobs), args.batch_size):
            batch = jobs[start:start + args.batch_size]
            try:
                results = await crawler.arun_many([job["url"] for job in batch], config=config)
            except Exception as error:
                results = []
                for job in batch:
                    job["bundle"].mkdir(parents=True, exist_ok=True)
                    payload = {"requestedUrl": job["url"], "resultUrl": "", "success": False,
                               "statusCode": 0, "error": str(error), "metadata": {},
                               "images": job["images"]}
                    (job["bundle"] / "result.json").write_text(
                        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                    records.append(payload)
            pending = {request_key(job["url"]): job for job in batch}
            for result in results:
                job = pending.pop(request_key(result.url), None)
                if job is None:
                    continue
                payload = save(job, result)
                records.append(payload)
                print(json.dumps({
                    "source": payload["requestedUrl"],
                    "success": payload["success"],
                    "status": payload["statusCode"],
                    "matched": sum(item.get("placeNameFound", False) for item in payload["images"]),
                    "images": len(payload["images"]),
                }, ensure_ascii=False), flush=True)
    manifest = {
        "reportPaths": args.report,
        "uniqueSourcePages": len(by_url),
        "scheduled": len(jobs),
        "saved": len(records),
        "successful": sum(record.get("success", False) for record in records),
        "identityMatchedImages": sum(
            item.get("placeNameFound", False)
            for record in records for item in record.get("images", [])
        ),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(crawl(parse_args()))
