#!/usr/bin/env python3
"""Archive current venue pages discovered for Suzhou place maintenance."""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


SOURCES = [
    ("横山分馆·狮山书房", "https://www.sohu.com/a/1042834001_121106832"),
    ("苏州图书馆人民路馆", "https://www.szlib.com/services/venues/renmin-road-venue"),
    ("苏州图书馆北馆", "https://www.szlib.com/services/venues/north-venue"),
]


async def main():
    output = Path("data/research/suzhou-place-completion-2026-08-16/current-venue-pages")
    output.mkdir(parents=True, exist_ok=True)
    records = []
    browser = BrowserConfig(headless=True)
    run = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, wait_until="networkidle", delay_before_return_html=2)
    async with AsyncWebCrawler(config=browser) as crawler:
        for index, (name, url) in enumerate(SOURCES, 1):
            result = await crawler.arun(url=url, config=run)
            markdown = result.markdown.raw_markdown if result.success else ""
            html = result.html or ""
            (output / f"{index:02d}.md").write_text(markdown, encoding="utf-8")
            (output / f"{index:02d}.html").write_text(html, encoding="utf-8")
            records.append({
                "name": name,
                "url": url,
                "finalUrl": result.url,
                "success": result.success,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "images": result.media.get("images", []) if result.success else [],
                "error": result.error_message or "",
            })
    (output / "index.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sources": len(records), "success": sum(row["success"] for row in records)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
