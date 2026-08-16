#!/usr/bin/env python3
"""Archive official Suzhou library and public-meal source pages with Crawl4AI."""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


OUTPUT_DIR = Path("data/research/suzhou-places-web-crawl-2026-08-16")
SOURCES = [
    {
        "kind": "libraries",
        "title": "苏州图书馆各分馆一览表",
        "url": "https://wglj.suzhou.gov.cn/szwhgdhlyj/tsg/201906/c618d7806a5c402bbe4ef709018f9335.shtml",
    },
    {
        "kind": "canteens",
        "title": "姑苏区沧浪街道万年家邻里食堂启用",
        "url": "https://www.suzhou.gov.cn/szsrmzf/mszx/202510/af69a7e455a54b51bce12c6d92f54dfa.shtml",
    },
    {
        "kind": "canteens",
        "title": "吴江三家老年人助餐点春节服务不打烊",
        "url": "https://www.suzhou.gov.cn/szsrmzf/lnrfw/202602/58f5468ea29f458fadb5be8842a4ce19.shtml",
    },
    {
        "kind": "canteens",
        "title": "吴中区两家新建银发助餐点",
        "url": "https://minzhengju.suzhou.gov.cn/mzj/sqdt/202411/914681f64f484c31a17eb5b455b1616f.shtml",
    },
    {
        "kind": "canteens",
        "title": "吴江区老年助餐点上新",
        "url": "https://minzhengju.suzhou.gov.cn/mzj/sqdt/202411/fdf80784074b49bb86377f2ae2a73118.shtml",
    },
    {
        "kind": "canteens",
        "title": "姑苏区家门口的老年餐桌",
        "url": "https://minzhengju.suzhou.gov.cn/mzj/sqdt/202409/e7f73e62698b4854879e1cadce208b78.shtml",
    },
]

CANTEENS = [
    {
        "name": "万年家邻里食堂",
        "address": "苏州市姑苏区阊胥路118号",
        "sourceIndex": 1,
        "description": "面向社区全年龄居民提供午餐和晚餐。",
    },
    {
        "name": "江兴社区耘林暖心食堂",
        "address": "苏州市吴江区仲英大道999号丽湾国际西北侧耘林生命公寓一楼",
        "sourceIndex": 2,
        "description": "江陵街道江兴社区老年助餐服务点，提供堂食。",
    },
    {
        "name": "吴江区民政综合服务中心老年食堂",
        "address": "苏州市吴江区油车路423号鲈乡新村四区东北侧",
        "sourceIndex": 2,
        "description": "吴江区老年助餐服务点，提供午餐堂食及外带。",
    },
    {
        "name": "光福镇福溪助餐点",
        "address": "苏州市吴中区光福镇福坤路18号",
        "sourceIndex": 3,
        "description": "设于福溪社区老年人日间照料中心的公益助餐点。",
    },
    {
        "name": "越溪街道珠村社区幸福食堂",
        "address": "苏州市吴中区越溪街道文溪路997号",
        "sourceIndex": 3,
        "description": "珠村社区面向老年人及特殊群体运营的社区助餐点。",
    },
    {
        "name": "桃源镇铜罗社区老年食堂",
        "address": "苏州市吴江区桃源镇铜罗社区麻溪路165号",
        "sourceIndex": 4,
        "description": "铜罗社区老年食堂，提供社区助餐服务。",
    },
    {
        "name": "裕社·早点来苏心小厨（西美社区助餐点）",
        "address": "苏州市姑苏区西美巷33号",
        "sourceIndex": 5,
        "description": "沧浪街道西美社区特色公益助餐点。",
    },
]


def markdown_text(result):
    markdown = result.markdown
    if markdown is None:
        return ""
    return getattr(markdown, "raw_markdown", None) or str(markdown)


def extract_libraries(html):
    rows = []
    soup = BeautifulSoup(html or "", "html.parser")
    for row in soup.select("tr"):
        cells = [re.sub(r"\s+", "", cell.get_text(" ", strip=True)) for cell in row.select("th,td")]
        if len(cells) < 3 or not re.fullmatch(r"\d+", cells[0]):
            continue
        name, address = cells[1], cells[2]
        if not name or not address or "地址" in address:
            continue
        canonical_name = name if "图书馆" in name else f"苏州图书馆（{name}）"
        rows.append({
            "name": canonical_name,
            "sourceName": name,
            "category": "图书馆",
            "address": address if address.startswith("苏州") else f"苏州市{address}",
            "hours": "",
            "description": "苏州公共图书馆总分馆体系服务点。",
            "sourceIndex": 0,
        })
    return list({(item["name"], item["address"]): item for item in rows}.values())


async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    libraries = []
    config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, word_count_threshold=1)
    browser = BrowserConfig(headless=True, verbose=False)
    async with AsyncWebCrawler(config=browser) as crawler:
        for index, source in enumerate(SOURCES):
            result = await crawler.arun(url=source["url"], config=config)
            digest = hashlib.sha256(source["url"].encode()).hexdigest()[:16]
            markdown_path = OUTPUT_DIR / f"{index:02d}-{digest}.md"
            html_path = OUTPUT_DIR / f"{index:02d}-{digest}.html"
            markdown = markdown_text(result) if result.success else ""
            markdown_path.write_text(markdown, encoding="utf-8")
            html_path.write_text(result.html or "", encoding="utf-8")
            if source["kind"] == "libraries" and result.success:
                libraries = extract_libraries(result.html)
            records.append({
                **source,
                "success": bool(result.success),
                "statusCode": result.status_code,
                "resultUrl": result.url,
                "error": result.error_message or "",
                "markdownPath": str(markdown_path),
                "htmlPath": str(html_path),
                "markdownLength": len(markdown),
            })
            print(f"{index + 1}/{len(SOURCES)} {source['title']}: {'ok' if result.success else 'failed'}", flush=True)

    canteens = [{
        **item,
        "category": "食堂",
        "hours": "",
    } for item in CANTEENS]
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "method": "Crawl4AI fresh official-source archive",
        "sources": records,
        "libraryCount": len(libraries),
        "canteenCount": len(canteens),
        "candidates": libraries + canteens,
    }
    (OUTPUT_DIR / "candidates.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"候选 {len(libraries)} 家图书馆、{len(canteens)} 家食堂", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
