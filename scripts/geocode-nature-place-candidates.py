#!/usr/bin/env python3
"""Verify nature candidates with Apple Maps China and save GCJ-02 coordinates."""

import argparse
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright


CITY_CONFIG = {
    "上海市": {"center": (31.23, 121.47), "span": (1.4, 1.8), "bounds": (30.6, 31.9, 120.8, 122.2)},
    "苏州市": {"center": (31.30, 120.58), "span": (1.4, 1.8), "bounds": (30.7, 32.1, 119.8, 121.3)},
    "嘉兴市": {"center": (30.75, 120.75), "span": (0.9, 1.1), "bounds": (30.25, 31.05, 120.3, 121.35)},
    "南通市": {"center": (32.05, 120.9), "span": (1.4, 1.8), "bounds": (31.55, 32.75, 120.2, 122.05)},
    "无锡市": {"center": (31.55, 120.3), "span": (1.1, 1.3), "bounds": (31.05, 32.1, 119.45, 120.75)},
    "镇江市": {"center": (32.1, 119.4), "span": (1.0, 1.2), "bounds": (31.55, 32.4, 118.9, 119.95)},
}
DISTRICT_PATTERN = re.compile(
    r"浦东新区|黄浦区|徐汇区|长宁区|静安区|普陀区|虹口区|杨浦区|闵行区|宝山区|嘉定区|金山区|松江区|青浦区|奉贤区|崇明区|"
    r"姑苏区|虎丘区|吴中区|相城区|吴江区|苏州工业园区|苏州高新区|常熟市|张家港市|昆山市|太仓市|"
    r"南湖区|秀洲区|嘉善县|海盐县|海宁市|平湖市|桀乡市|嘉兴经开区|嘉兴港区|"
    r"崇川区|通州区|海门区|海安市|如东县|启东市|如皋市|南通开发区|通州湾示范区|"
    r"梁溪区|锡山区|惠山区|滨湖区|新吴区|江阴市|宜兴市|无锡经开区|"
    r"京口区|润州区|丹徒区|镇江新区|丹阳市|扬中市|句容市"
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-dir", default="data/research/nature-places-2026-09-12")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def normalize_name(value):
    return re.sub(r"[（）()\s\-_·•]", "", str(value or "")).replace("一期", "").replace("二期", "")


def district(value):
    match = DISTRICT_PATTERN.search(str(value or ""))
    return match.group(0) if match else ""


def name_match(source, candidate):
    left, right = normalize_name(source), normalize_name(candidate)
    return bool(left and right and (left == right or (len(left) >= 4 and (left in right or right in left))))


async def apple_search(page, query, config):
    return await page.evaluate(
        """async ({query, center, span}) => {
          const search = new mapkit.Search({
            language: 'zh-CN',
            region: new mapkit.CoordinateRegion(
              new mapkit.Coordinate(center[0], center[1]),
              new mapkit.CoordinateSpan(span[0], span[1])
            )
          });
          return new Promise((resolve, reject) => search.search(query, (error, data) => {
            if (error) reject(new Error(String(error)));
            else resolve(data.places.slice(0, 12).map((item) => ({
              name: item.name || '', address: item.formattedAddress || '',
              latitude: item.coordinate.latitude, longitude: item.coordinate.longitude
            })));
          }));
        }""",
        {"query": query, "center": config["center"], "span": config["span"]},
    )


def rank(place, item, address_search=False):
    config = CITY_CONFIG[place["city"]]
    latitude, longitude = float(item["latitude"]), float(item["longitude"])
    south, north, west, east = config["bounds"]
    inside = south <= latitude <= north and west <= longitude <= east
    same_name = name_match(place["name"], item["name"])
    source_district = district(place.get("district")) or district(place.get("addressHint"))
    map_district = district(item.get("address"))
    same_district = not source_district or not map_district or source_district == map_district
    score = (70 if same_name else 0) + (20 if same_district else 0) + (10 if item.get("address") else 0)
    address_supported = address_search and bool(place.get("addressHint")) and same_district
    return {**item, "score": score, "insideCity": inside, "nameMatch": same_name, "districtMatch": same_district,
            "accepted": inside and bool(item.get("address")) and ((same_name and same_district) or address_supported),
            "acceptanceBasis": "official_location_and_map_match" if address_supported and not same_name else "map_exact_identity"}


async def main():
    args = parse_args()
    research_dir = Path(args.research_dir)
    input_payload = json.loads((research_dir / "candidates.json").read_text(encoding="utf-8"))
    output_path = research_dir / "geocoded-candidates.json"
    existing = {}
    if args.resume and output_path.exists():
        previous = json.loads(output_path.read_text(encoding="utf-8"))
        existing = {(item["city"], item["name"]): item for item in previous.get("records", [])}
    candidates = input_payload["candidates"][:args.limit or None]
    records = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        page = await browser.new_page(locale="zh-CN")
        await page.goto("https://maps.apple.com.cn/search?query=x&center=31.5,120.4&span=2,3", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        for index, place in enumerate(candidates):
            key = (place["city"], place["name"])
            if key in existing and existing[key].get("status") == "approved":
                records.append(existing[key])
                continue
            query = " ".join(filter(None, [place["city"], place.get("district", ""), place["name"]]))
            try:
                map_candidates = await apple_search(page, query, CITY_CONFIG[place["city"]])
                ranked = sorted((rank(place, item) for item in map_candidates), key=lambda item: item["score"], reverse=True)
                match = next((item for item in ranked if item["accepted"]), None)
                address_query = ""
                if not match and place.get("addressHint"):
                    address_query = " ".join(filter(None, [place["city"], place.get("district", ""), place["addressHint"]]))
                    address_candidates = await apple_search(page, address_query, CITY_CONFIG[place["city"]])
                    address_ranked = sorted((rank(place, item, True) for item in address_candidates), key=lambda item: item["score"], reverse=True)
                    ranked.extend(address_ranked)
                    match = next((item for item in address_ranked if item["accepted"]), None)
                records.append({**place, "query": query, "status": "approved" if match else "review",
                                "addressQuery": address_query,
                                "mapResult": match or (ranked[0] if ranked else None), "mapCandidates": ranked})
            except Exception as error:
                records.append({**place, "query": query, "status": "error", "error": str(error)})
            if (index + 1) % 20 == 0 or records[-1]["status"] != "approved":
                print(f"{index + 1}/{len(candidates)} {place['name']}: {records[-1]['status']}", flush=True)
            if (index + 1) % 50 == 0:
                output_path.write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            await page.wait_for_timeout(150)
        await browser.close()
    output_path.write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Apple 地图中国区（高德底图）", "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {status: sum(item["status"] == status for item in records) for status in ("approved", "review", "error")}
    print(json.dumps(counts, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
