#!/usr/bin/env python3
"""Archive current Suzhou Library location API data with Crawl4AI."""

import asyncio
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


URLS = [
    f"https://www.szlib.com/website/api/v1/locations?category_id={category_id}"
    for category_id in (49, 50, 51, 149)
]
OUTPUT = Path("data/research/suzhou-place-completion-2026-08-16/official-library-api")


def markdown_text(result):
    markdown = result.markdown
    if hasattr(markdown, "raw_markdown"):
        return markdown.raw_markdown or ""
    return str(markdown or "")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    browser = BrowserConfig(headless=True, verbose=False)
    config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, word_count_threshold=1)
    records = []
    items = []
    async with AsyncWebCrawler(config=browser) as crawler:
        for url in URLS:
            result = await crawler.arun(url=url, config=config)
            body = result.html or ""
            markdown = markdown_text(result)
            digest = hashlib.sha256(url.encode()).hexdigest()[:12]
            html_path = OUTPUT / f"{digest}.html"
            markdown_path = OUTPUT / f"{digest}.md"
            html_path.write_text(body, encoding="utf-8")
            markdown_path.write_text(markdown, encoding="utf-8")
            match = re.search(r"<pre>(.*?)</pre>", body, re.DOTALL)
            json_body = html.unescape(match.group(1)) if match else body
            payload = json.loads(json_body) if result.success else {}
            page_items = ((payload.get("data") or {}).get("items") or [])
            items.extend(page_items)
            records.append({
                "url": url,
                "resultUrl": result.url,
                "success": bool(result.success),
                "statusCode": result.status_code,
                "error": result.error_message or "",
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "contentHash": hashlib.sha256(body.encode()).hexdigest(),
                "htmlPath": str(html_path),
                "markdownPath": str(markdown_path),
                "itemCount": len(page_items),
            })
    (OUTPUT / "locations.json").write_text(json.dumps({
        "archiveVersion": "suzhou-library-locations-v1",
        "records": records,
        "items": items,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sources": len(records), "items": len(items)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
