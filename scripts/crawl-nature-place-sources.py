#!/usr/bin/env python3
"""Archive official public park sources and build nature-place candidates.

Discovery only. Database writes are handled by admin/scripts/apply-nature-places.mjs.
"""

import argparse
import asyncio
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


SHANGHAI_INDEX = "https://web.lhsr.sh.gov.cn/citymap/garden/index"
SHANGHAI_API = "https://web.lhsr.sh.gov.cn/citymap/garden/park_list"
SHANGHAI_IMAGE_ROOT = "https://web.lhsr.sh.gov.cn/warehouse/upload/"
SUPPLEMENTAL_SOURCES = [
    {
        "city": "苏州市",
        "title": "向绿而行，苏州的当下与未来",
        "url": "https://www.suzhou.gov.cn/szsrmzf/szyw/202503/1552506c74b44d60899410e10a58668d.shtml",
    },
    {
        "city": "苏州市",
        "title": "书写水明珠生态新篇章",
        "url": "https://www.suzhou.gov.cn/szsrmzf/szyw/202501/6b9294121a0749d7a5c25fff58bf7d09.shtml",
    },
    {
        "city": "南通市",
        "title": "南通市第二批开放共享城市绿地清单",
        "url": "https://ntcoop.nantong.gov.cn/ntgxhzs/bmfw/content/8b178534-5230-4890-8222-b6f716a1081d.html",
    },
    {
        "city": "无锡市",
        "title": "无锡市第二批开放共享公园绿地名录",
        "url": "https://gyj.wuxi.gov.cn/doc/2024/05/23/4315240.shtml",
    },
    {
        "city": "嘉兴市",
        "title": "第二届嘉兴市最美公园候选名单",
        "url": "https://jsj.jiaxing.gov.cn/art/2021/10/8/art_1637037_58928026.html",
    },
    {
        "city": "镇江市",
        "title": "江苏首批开放共享公园绿地",
        "url": "https://jsszfhcxjst.jiangsu.gov.cn/art/2023/4/10/art_8642_10857577.html",
    },
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="data/research/nature-places-2026-09-12")
    parser.add_argument("--shanghai-only", action="store_true")
    return parser.parse_args()


def clean_text(value):
    return re.sub(r"\s+", "", BeautifulSoup(html.unescape(str(value or "")), "html.parser").get_text(" "))


def practical_description(value):
    text = clean_text(value).replace("公园历史：", "").replace("景观特色：", "")
    sentences = [item.strip() for item in re.split(r"(?<=[。！？])", text) if item.strip()]
    fact_terms = re.compile(
        r"位于|东至|西至|南至|北至|面积|建成|改造|沿|河|湖|江|水系|湿地|"
        r"步道|草坪|树|植物|花|廊|亭|广场|座椅|儿童|运动|健身|公厕|"
        r"卫生间|无障碍|停车|亲水|栈道|驿站|入口|雕塑|场地|区域"
    )
    promotional = re.compile(r"值得|打卡|网红|绝佳|最佳|绝美|令人|让人|不妨|名片|理想去处")
    selected = []
    for sentence in sentences:
        if fact_terms.search(sentence) and not promotional.search(sentence):
            selected.append(sentence)
        if len("".join(selected)) >= 320 or len(selected) >= 5:
            break
    result = "".join(selected) or "".join(sentences[:3])
    return result[:520].rstrip("，。；; ")


def raw_location(value):
    text = clean_text(value)
    match = re.search(r"(?:位于|坐落于|地处)([^\u3002；;]{4,90})", text)
    return match.group(1).strip("，, ") if match else ""


async def fetch_shanghai(output_dir):
    headers = {"User-Agent": "Mozilla/5.0", "Referer": SHANGHAI_INDEX}
    records = []
    pages = []
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=60) as client:
        for page_index in range(1, 100):
            response = await client.post(SHANGHAI_API, data={"pageIndex": page_index})
            response.raise_for_status()
            payload = response.json()
            rows = payload.get("parkList") or []
            pages.append({"pageIndex": page_index, "count": len(rows), "contentHash": hashlib.sha256(response.content).hexdigest()})
            for row in rows:
                source_url = f"https://lhsr.sh.gov.cn/gyldml_con/?InfoId={row.get('id', '')}"
                records.append({
                    "sourceId": row.get("id", ""),
                    "name": clean_text(row.get("Name")),
                    "category": "自然",
                    "city": "上海市",
                    "district": clean_text(row.get("Keyword")),
                    "addressHint": raw_location(row.get("Content")),
                    "hours": "",
                    "description": practical_description(row.get("Content")),
                    "photoCandidates": [{
                        "url": f"{SHANGHAI_IMAGE_ROOT}{row.get('FileName1')}",
                        "sourcePage": source_url,
                        "identityBasis": "上海市绿化和市容管理局公园名录条目主图",
                    }] if row.get("FileName1") else [],
                    "sourceUrl": source_url,
                    "sourceTitle": "上海市公园（绿地）名录",
                    "sourceContentHash": hashlib.sha256(str(row.get("Content", "")).encode()).hexdigest(),
                })
            print(f"上海名录 {page_index}: {len(rows)}", flush=True)
            if len(rows) < 16:
                break
            await asyncio.sleep(0.15)
    (output_dir / "shanghai-api-pages.json").write_text(
        json.dumps(pages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return records


async def crawl_supplemental(output_dir, sources):
    archive = []
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=1,
        page_timeout=60000,
        wait_for_images=True,
        delay_before_return_html=1.0,
        scan_full_page=True,
        max_scroll_steps=6,
        remove_overlay_elements=True,
    )
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, enable_stealth=True)) as crawler:
        for index, source in enumerate(sources):
            result = await crawler.arun(url=source["url"], config=config)
            markdown = getattr(result.markdown, "raw_markdown", None) or str(result.markdown or "")
            stem = f"supplemental-{index + 1:02d}-{source['city']}"
            markdown_path = output_dir / f"{stem}.md"
            html_path = output_dir / f"{stem}.html"
            markdown_path.write_text(markdown, encoding="utf-8")
            html_path.write_text(result.html or "", encoding="utf-8")
            archive.append({
                **source,
                "success": bool(result.success),
                "statusCode": result.status_code,
                "resultUrl": result.url,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "pageTitle": str((result.metadata or {}).get("title", "")),
                "markdownPath": str(markdown_path),
                "htmlPath": str(html_path),
                "contentHash": hashlib.sha256(markdown.encode()).hexdigest(),
                "error": result.error_message or "",
            })
            print(f"{source['city']} {source['title']}: {'ok' if result.success else 'failed'}", flush=True)
    return archive


async def main():
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    shanghai_records, supplemental = await asyncio.gather(
        fetch_shanghai(output_dir),
        crawl_supplemental(output_dir, [] if args.shanghai_only else SUPPLEMENTAL_SOURCES),
    )
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "taskVersion": "nature-places-v1",
        "ruleDocument": "docs/place-data-maintenance.md",
        "method": "Crawl4AI official-source archive plus Shanghai official directory API pagination",
        "sources": [{
            "city": "上海市",
            "title": "上海市公园（绿地）名录",
            "url": SHANGHAI_INDEX,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }, *supplemental],
        "candidates": shanghai_records,
    }
    (output_dir / "candidates.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"candidates": len(shanghai_records), "supplementalSources": len(supplemental)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
