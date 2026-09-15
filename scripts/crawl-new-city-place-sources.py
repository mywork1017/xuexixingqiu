#!/usr/bin/env python3
"""Archive and parse official place sources for Jiaxing, Nantong, Wuxi, and Zhenjiang."""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pdfplumber
from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


OUTPUT_DIR = Path("data/research/new-city-places-2026-08-16")
JIAxing_PDF_URL = (
    "https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/"
    "jcms_files/jcms1/web2778/site/attach/0/8dd692822e904629b711a5c7da969c93.pdf"
)
HTML_SOURCES = [
    {
        "kind": "jiaxing_canteens",
        "title": "南湖社区幸福食堂鸳湖小馆启用",
        "url": "https://www.sina.cn/news/detail/5259367546100056.html",
    },
    {
        "kind": "nantong_libraries",
        "title": "南通市图书馆各分馆一览表",
        "url": "https://wglj.nantong.gov.cn/ntswgxj/ggxxcx/content/437ed23e-ffd8-41e5-8ba4-7383f12003d5.html",
    },
    {
        "kind": "nantong_canteens",
        "title": "通州区老年助餐点让舌尖幸福触手可及",
        "url": "https://www.nantong.gov.cn/ntsrmzf/sxcz/content/9a467080-6104-462b-987f-add7927960b9.html",
    },
    {
        "kind": "nantong_current_canteens",
        "title": "家门口的食堂吃出幸福味",
        "url": "https://www.nantong.gov.cn/ntsrmzf/ntxw/content/886bb721-213e-4ca2-8dd7-c0bc457569a1.htm",
    },
    {
        "kind": "wuxi_libraries",
        "title": "无锡公共图书馆场馆一览",
        "url": "https://en.wuxi.gov.cn/venues.html",
    },
    {
        "kind": "wuxi_canteens",
        "title": "无锡市2025年度拟赋三星区域性老年人助餐中心名单公示",
        "url": "https://mzj.wuxi.gov.cn/doc/2025/11/28/4689596.shtml",
    },
    {
        "kind": "wuxi_canteen_addresses",
        "title": "无锡市滨湖区老年助餐点地址",
        "url": "https://m.wx.bendibao.com/wangdian/yanglaozhucandian/binhuqu/",
    },
    {
        "kind": "zhenjiang_libraries",
        "title": "江苏省政府公报赠阅点公共图书馆名录",
        "url": "https://www.jiangsu.gov.cn/col/col59196/index.html",
    },
    {
        "kind": "zhenjiang_canteens",
        "title": "扬中打造79家养老助餐点",
        "url": "https://www.zgjssw.gov.cn/shixianchuanzhen/zhenjiang/202508/t20250813_8512534.shtml",
    },
    {
        "kind": "zhenjiang_current_canteens",
        "title": "英雄社区长者爱心食堂开业",
        "url": "https://news.10jqka.com.cn/20260506/c676483442.shtml",
    },
]

NANTONG_PARENT_BY_SECTION = {
    "南通图书馆主馆一览表": "南通市图书馆",
    "海安市各分馆一览表": "海安市图书馆",
    "如皋市各分馆一览表": "如皋市图书馆",
    "如东县各分馆一览表": "如东县图书馆",
    "启东市各分馆一览表": "启东市图书馆",
    "崇川区各分馆一览表": "崇川区图书馆",
    "通州区各分馆一览表": "通州区图书馆",
    "海门区各分馆一览表": "南通市海门区图书馆",
    "开发区各分馆一览表": "南通开发区图书馆",
}
NANTONG_EXCLUDED = re.compile(
    r"集团|公司|电气|小学|中学|幼儿园|学校|检察院|法院|看守所|公安局|"
    r"财政局|人社局|审计局|中医院|卫健委|政务服务|总工会|部队|招商重工|"
    r"金融广场|少年宫|中外运|农场|纳米科技|社会内部|"
    r"市一中|恒科新材料|希诺实业|法律分馆"
)

WUXI_LIBRARIES = [
    ("无锡市图书馆", "无锡市梁溪区钟书路1号"),
    ("无锡市梁溪区图书馆", "无锡市梁溪区人民东路328号"),
    ("无锡市锡山区图书馆", "无锡市锡山区迎宾北路6号"),
    ("无锡市惠山区图书馆", "无锡市惠山区政和大道187号"),
    ("无锡市滨湖区图书馆", "无锡市滨湖区金城西路500号"),
    ("无锡市新吴区图书馆", "无锡市新吴区行创四路111号民生大厦5楼"),
    ("江阴市图书馆", "无锡市江阴市澄江中路128号"),
    ("宜兴市图书馆", "无锡市宜兴市解放东路388号"),
]
WUXI_CANTEENS = [
    "江阴市申港街道区域性助餐中心", "江阴市澄江街道助餐中心",
    "梁溪区清名桥街道君来助餐中心", "梁溪区瞻江街道幸福助餐中心",
    "梁溪区惠山街道汉悦助餐中心", "梁溪区广益街道熙悦助餐中心",
    "梁溪区扬名街道福扬助餐中心", "锡山区东亭街道助餐中心",
    "锡山区东港镇助餐中心", "滨湖区河埒街道北桥区域性助餐中心",
    "滨湖区蠡园街道西园区域性助餐中心", "滨湖区马山街道峰影区域性助餐中心",
    "新吴区新安街道助餐中心", "新吴区旺庄街道助餐中心",
    "新吴区江溪街道助餐中心二", "无锡经开区太湖街道老年人助餐中心耘林阅府点",
]
WUXI_CANTEEN_ADDRESSES = {
    "滨湖区\u8821园街道西园区域性助餐中心": "无锡市滨湖区西园里393号",
}
ZHENJIANG_LIBRARIES = [
    ("镇江市图书馆", "镇江市京口区解放路17号"),
    ("镇江市丹徒区图书馆", "镇江市丹徒区长山路281号"),
    ("镇江市润州区图书馆", "镇江市润州区三茅宫三区8号"),
    ("丹阳市图书馆", "镇江市丹阳市西环路21号"),
    ("句容市图书馆", "镇江市句容市肖杆路文化艺术中心内"),
    ("扬中市图书馆", "镇江市扬中市三茅街道文化北路46号"),
]


def clean(value):
    return re.sub(r"\s+", "", str(value or ""))


def markdown_text(result):
    markdown = result.markdown
    return getattr(markdown, "raw_markdown", None) or str(markdown or "")


def candidate(name, category, address, city, source_index, **extra):
    return {
        "name": clean(name), "category": category, "address": clean(address), "city": city,
        "hours": "", "description": "", "sourceIndex": source_index, **extra,
    }


def parse_jiaxing(pdf_path, source_index):
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in range(2, 6):
            for table in pdf.pages[page_number].extract_tables():
                for row in table:
                    if not row or not str(row[0] or "").isdigit():
                        continue
                    raw_name = clean(row[1])
                    if "图书馆" not in raw_name:
                        continue
                    name = raw_name.removesuffix("健心客厅")
                    rows.append(candidate(
                        name, "图书馆", row[2], "嘉兴市", source_index,
                        sourceRow=int(row[0]), sourcePage=page_number + 1,
                        historicalHours=clean(row[3]),
                    ))
    return rows


def canonical_nantong_name(raw_name, section):
    name = clean(raw_name)
    if "图书馆" in name:
        return name
    parent = NANTONG_PARENT_BY_SECTION.get(section, "南通市图书馆")
    branch = name.removesuffix("分馆")
    return f"{parent}（{branch}分馆）"


def parse_nantong(html, source_index):
    soup = BeautifulSoup(html or "", "html.parser")
    section = ""
    rows = []
    for table_row in soup.select("tr"):
        cells = [re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip() for cell in table_row.select("th,td")]
        if len(cells) == 1 and cells[0] in NANTONG_PARENT_BY_SECTION:
            section = cells[0]
            continue
        if len(cells) < 3 or not cells[0].isdigit() or NANTONG_EXCLUDED.search(cells[1]):
            continue
        rows.append(candidate(
            canonical_nantong_name(cells[1], section), "图书馆", cells[2], "南通市", source_index,
            sourceSection=section, sourceRow=int(cells[0]),
        ))
    return rows


async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = OUTPUT_DIR / "jiaxing-public-library-list.pdf"
    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        response = await client.get(JIAxing_PDF_URL, headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        pdf_path.write_bytes(response.content)

    fetched_at = datetime.now(timezone.utc).isoformat()
    source_records = [{
        "kind": "jiaxing_libraries", "title": "2021年度嘉兴市公共图书馆健心客厅名单",
        "url": JIAxing_PDF_URL, "success": True, "fetchedAt": fetched_at,
        "contentHash": hashlib.sha256(pdf_path.read_bytes()).hexdigest(), "pdfPath": str(pdf_path),
    }]
    html_by_kind = {}
    crawl_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS, word_count_threshold=1, page_timeout=60000,
        wait_for_images=True, delay_before_return_html=1.0, scan_full_page=True, max_scroll_steps=6,
    )
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
        for source in HTML_SOURCES:
            result = await crawler.arun(url=source["url"], config=crawl_config)
            index = len(source_records)
            markdown = markdown_text(result) if result.success else ""
            markdown_path = OUTPUT_DIR / f"{index:02d}-{source['kind']}.md"
            html_path = OUTPUT_DIR / f"{index:02d}-{source['kind']}.html"
            markdown_path.write_text(markdown, encoding="utf-8")
            html_path.write_text(result.html or "", encoding="utf-8")
            html_by_kind[source["kind"]] = result.html or ""
            source_records.append({
                **source, "success": bool(result.success), "statusCode": result.status_code,
                "resultUrl": result.url, "error": result.error_message or "", "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "pageTitle": str((result.metadata or {}).get("title", "")),
                "publishedAt": str((result.metadata or {}).get("date", "")),
                "contentHash": hashlib.sha256(markdown.encode()).hexdigest(),
                "markdownPath": str(markdown_path), "htmlPath": str(html_path),
            })
            print(f"{source['title']}: {'ok' if result.success else 'failed'}", flush=True)

    source_index = {source["kind"]: index for index, source in enumerate(source_records)}
    candidates = parse_jiaxing(pdf_path, source_index["jiaxing_libraries"])
    candidates.append(candidate(
        "鸳湖小馆（南湖社区幸福食堂）", "食堂", "嘉兴市南湖区纺工路59号", "嘉兴市", source_index["jiaxing_canteens"],
        description="提供适老化堂食和居家盒饭配送",
    ))
    candidates.extend(parse_nantong(html_by_kind.get("nantong_libraries", ""), source_index["nantong_libraries"]))
    candidates.append(candidate(
        "南山社区食堂", "食堂", "南通市通州区金沙街道青年路8号", "南通市", source_index["nantong_canteens"],
        description="面向老年人提供助餐补贴和堂食服务",
    ))
    candidates.append(candidate(
        "学田四季食事社区食堂", "食堂", "南通市崇川区学田南路28号学田菜市场2楼北侧", "南通市", source_index["nantong_current_canteens"],
        hours="10:30—13:00；17:00—19:30", description="设老年人就餐区，提供堂食和送餐服务",
    ))
    candidates.extend(candidate(name, "图书馆", address, "无锡市", source_index["wuxi_libraries"]) for name, address in WUXI_LIBRARIES)
    candidates.extend(candidate(
        name, "食堂", WUXI_CANTEEN_ADDRESSES.get(name, ""), "无锡市",
        source_index["wuxi_canteen_addresses"] if name in WUXI_CANTEEN_ADDRESSES else source_index["wuxi_canteens"],
        description="提供堂食、社区助餐和配送服务" if name in WUXI_CANTEEN_ADDRESSES else "",
    ) for name in WUXI_CANTEENS)
    candidates.extend(candidate(name, "图书馆", address, "镇江市", source_index["zhenjiang_libraries"]) for name, address in ZHENJIANG_LIBRARIES)
    candidates.extend([
        candidate("英雄社区长者爱心食堂", "食堂", "镇江市扬中市三茅街道英雄路199号", "镇江市", source_index["zhenjiang_current_canteens"], hours="10:50—12:30", description="面向社会开放，提供老年人优惠和送餐服务"),
        candidate("广宁社区老年助餐点", "食堂", "", "镇江市", source_index["zhenjiang_canteens"]),
    ])
    unique = {}
    for item in candidates:
        unique[(item["category"], item["name"], item["address"])] = item
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "method": "Crawl4AI official-source archive plus official PDF table extraction",
        "ruleDocument": "docs/place-data-maintenance.md", "sources": source_records,
        "candidates": list(unique.values()),
    }
    (OUTPUT_DIR / "candidates.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {}
    for item in payload["candidates"]:
        key = f"{item['city']}|{item['category']}"
        counts[key] = counts.get(key, 0) + 1
    print(json.dumps(counts, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
