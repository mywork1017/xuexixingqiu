#!/usr/bin/env python3
"""Verify Suzhou place candidates against Apple Maps China (Amap basemap)."""

import asyncio
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright


RESEARCH_DIR = Path("data/research/suzhou-places-web-crawl-2026-08-16")
INPUT_PATH = RESEARCH_DIR / "candidates.json"
OUTPUT_PATH = RESEARCH_DIR / "geocoded-candidates.json"
CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def normalize(value):
    return re.sub(
        r"上海市?|苏州市?|社区|街道|乡|镇|文化活动中心|文化中心|服务中心|分馆|馆|[^0-9a-z\u4e00-\u9fff]",
        "",
        str(value or "").lower(),
    )


def address_tokens(value):
    return re.findall(r"[\u4e00-\u9fff]{1,16}(?:路|街|巷|弄|大道)\d+(?:弄\d+)?号", str(value or ""))


def score_candidate(place, candidate):
    left_name = normalize(place["name"])
    right_name = normalize(candidate["name"])
    name_match = bool(left_name and right_name and (left_name in right_name or right_name in left_name))
    input_tokens = address_tokens(place["address"])
    candidate_text = str(candidate["address"]).replace(" ", "")
    address_match = any(token in candidate_text for token in input_tokens)
    inside_suzhou = 30.7 <= candidate["latitude"] <= 32.1 and 119.8 <= candidate["longitude"] <= 121.3
    score = (45 if name_match else 0) + (65 if address_match else 0) + (10 if inside_suzhou else -100)
    return score, name_match, address_match, inside_suzhou


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=INPUT_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=CHROME_PATH)
        page = await browser.new_page(locale="zh-CN")
        await page.goto(
            "https://maps.apple.com.cn/search?query=x&center=31.30,120.62&span=1.2,1.2",
            wait_until="domcontentloaded",
        )
        await page.wait_for_timeout(3500)
        for index, place in enumerate(payload["candidates"]):
            query = f"{place['name']} {place['address']}"
            try:
                candidates = await page.evaluate(
                    """async ({query}) => {
                      const search = new mapkit.Search({
                        language: 'zh-CN',
                        region: new mapkit.CoordinateRegion(
                          new mapkit.Coordinate(31.30, 120.62),
                          new mapkit.CoordinateSpan(1.2, 1.2)
                        )
                      });
                      return new Promise((resolve, reject) => search.search(query, (error, data) => {
                        if (error) reject(new Error(String(error)));
                        else resolve(data.places.slice(0, 8).map((item) => ({
                          name: item.name || '',
                          address: item.formattedAddress || '',
                          latitude: item.coordinate.latitude,
                          longitude: item.coordinate.longitude
                        })));
                      }));
                    }""",
                    {"query": query},
                )
                ranked = []
                for candidate in candidates:
                    score, name_match, address_match, inside_suzhou = score_candidate(place, candidate)
                    ranked.append({
                        **candidate,
                        "score": score,
                        "nameMatch": name_match,
                        "addressMatch": address_match,
                        "insideSuzhou": inside_suzhou,
                    })
                ranked.sort(key=lambda item: item["score"], reverse=True)
                best = ranked[0] if ranked else None
                accepted = bool(best and best["insideSuzhou"] and (best["addressMatch"] or best["nameMatch"]))
                records.append({
                    **place,
                    "status": "approved" if accepted else "review",
                    "query": query,
                    "mapResult": best,
                    "mapCandidates": ranked,
                })
            except Exception as error:
                records.append({**place, "status": "error", "query": query, "error": str(error)})
            print(f"{index + 1}/{len(payload['candidates'])} {place['name']}: {records[-1]['status']}", flush=True)
            await page.wait_for_timeout(300)
        await browser.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "Apple 地图中国区（高德底图）",
            "records": records,
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"坐标通过 {sum(item['status'] == 'approved' for item in records)} / {len(records)}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
