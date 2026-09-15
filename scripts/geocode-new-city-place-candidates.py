#!/usr/bin/env python3
"""Verify four-city candidates against Apple Maps China and save GCJ-02 coordinates."""

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright


RESEARCH_DIR = Path("data/research/new-city-places-2026-08-16")
INPUT_PATH = RESEARCH_DIR / "candidates.json"
OUTPUT_PATH = RESEARCH_DIR / "geocoded-candidates.json"
CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CITY_MAP = {
    "嘉兴市": {"center": (30.75, 120.75), "span": (0.9, 1.1), "bounds": (30.25, 31.05, 120.3, 121.35)},
    "南通市": {"center": (32.05, 120.9), "span": (1.4, 1.8), "bounds": (31.55, 32.75, 120.2, 122.05)},
    "无锡市": {"center": (31.55, 120.3), "span": (1.1, 1.3), "bounds": (31.05, 32.1, 119.45, 120.75)},
    "镇江市": {"center": (32.1, 119.4), "span": (1.0, 1.2), "bounds": (31.55, 32.4, 118.9, 119.95)},
}
DISTRICTS = re.compile(
    r"南湖区|秀洲区|嘉善县|海盐县|海宁市|平湖市|桐乡市|"
    r"崇川区|通州区|海门区|海安市|如东县|启东市|如皋市|"
    r"梁溪区|锡山区|惠山区|滨湖区|新吴区|江阴市|宜兴市|"
    r"京口区|润州区|丹徒区|丹阳市|扬中市|句容市"
)
ROAD_NUMBER = re.compile(r"([一-鿿]{1,12}(?:公路|大道|路|街|巷|弄|里))\s*(\d+(?:-\d+)?)号?")


def clean(value):
    return re.sub(r"\s+", "", str(value or ""))


def normalize_name(value):
    return re.sub(
        r"嘉兴市?|南通市?|无锡市?|镇江市?|社区|街道|乡|镇|分馆|馆|[（）()\W_]",
        "", clean(value).lower(),
    )


def district(value):
    match = DISTRICTS.search(clean(value))
    return match.group(0) if match else ""


def road_numbers(value):
    matches = []
    for match in ROAD_NUMBER.finditer(clean(value)):
        road = re.split(r"省|市|区|县|街道|镇|乡", match.group(1))[-1]
        matches.append((road.replace("大道", "路").replace("公路", "路"), match.group(2)))
    return matches


def score_candidate(place, item):
    city = CITY_MAP[place["city"]]
    latitude, longitude = float(item["latitude"]), float(item["longitude"])
    south, north, west, east = city["bounds"]
    inside = south <= latitude <= north and west <= longitude <= east
    left_name, right_name = normalize_name(place["name"]), normalize_name(item["name"])
    name_match = bool(left_name and right_name and (left_name in right_name or right_name in left_name))
    left_signature = "".join(sorted(left_name.replace("点", "")))
    right_signature = "".join(sorted(right_name.replace("点", "")))
    same_name_characters = bool(
        left_signature and right_signature and len(left_signature) >= 5 and left_signature == right_signature
    )
    exact_name_match = bool(left_name and right_name and (left_name == right_name or same_name_characters))
    input_district, result_district = district(place["address"]), district(item["address"])
    district_match = not input_district or not result_district or input_district == result_district
    input_roads = road_numbers(place["address"])
    result_roads = road_numbers(item["address"] or item["name"])
    road_match = any(
        left_number == right_number and (left_road.endswith(right_road) or right_road.endswith(left_road))
        for left_road, left_number in input_roads
        for right_road, right_number in result_roads
    )
    address_only_result = not item["address"] and bool(result_roads)
    exact_map_identity = exact_name_match and bool(result_district) and bool(item["address"])
    accepted = inside and district_match and (road_match or exact_map_identity)
    score = (25 if name_match else 0) + (15 if district_match else 0) + (60 if road_match else 0) + (75 if exact_map_identity else 0)
    return {
        "score": score, "accepted": accepted, "insideCity": inside, "nameMatch": name_match,
        "districtMatch": district_match, "streetNumberMatch": road_match, "exactNameMatch": exact_name_match,
        "acceptanceBasis": "map_exact_identity_and_address" if exact_map_identity else "official_address_and_map_match",
    }


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
            else resolve(data.places.slice(0, 8).map((item) => ({
              name: item.name || '', address: item.formattedAddress || '',
              latitude: item.coordinate.latitude, longitude: item.coordinate.longitude
            })));
          }));
        }""",
        {"query": query, "center": config["center"], "span": config["span"]},
    )


async def main():
    payload = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    requested_names = {name for name in os.environ.get("PLACE_NAMES", "").split(",") if name}
    candidates_to_process = [
        place for place in payload["candidates"] if not requested_names or place["name"] in requested_names
    ]
    existing_records = {}
    if requested_names and OUTPUT_PATH.exists():
        existing_payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        existing_records = {(item["category"], item["name"]): item for item in existing_payload.get("records", [])}
    records = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=CHROME_PATH)
        page = await browser.new_page(locale="zh-CN")
        await page.goto("https://maps.apple.com.cn/search?query=x&center=31.5,120.4&span=2,3", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        for index, place in enumerate(candidates_to_process):
            config = CITY_MAP[place["city"]]
            query = " ".join(part for part in [place["city"], place["name"], place["address"]] if part)
            try:
                candidates = await apple_search(page, query, config)
                ranked = [{**item, **score_candidate(place, item)} for item in candidates]
                ranked.sort(key=lambda item: item["score"], reverse=True)
                match = next((item for item in ranked if item["accepted"]), None)
                address_query = ""
                if not match and place["address"]:
                    address_query = f"{place['city']} {place['address']}"
                    address_candidates = await apple_search(page, address_query, config)
                    ranked.extend({**item, **score_candidate(place, item)} for item in address_candidates)
                    ranked.sort(key=lambda item: item["score"], reverse=True)
                    match = next((item for item in ranked if item["accepted"]), None)
                records.append({
                    **place, "query": query, "status": "approved" if match else "review",
                    "addressQuery": address_query, "mapResult": match or (ranked[0] if ranked else None), "mapCandidates": ranked,
                })
            except Exception as error:
                records.append({**place, "query": query, "status": "error", "error": str(error)})
            print(f"{index + 1}/{len(candidates_to_process)} {place['name']}: {records[-1]['status']}", flush=True)
            await page.wait_for_timeout(220)
        await browser.close()
    if requested_names:
        refreshed = {(item["category"], item["name"]): item for item in records}
        records = [
            refreshed.get((place["category"], place["name"]))
            or existing_records.get((place["category"], place["name"]))
            for place in payload["candidates"]
        ]
        records = [item for item in records if item]
    OUTPUT_PATH.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Apple 地图中国区（高德底图）",
        "records": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    approved = sum(item["status"] == "approved" for item in records)
    print(f"坐标自动通过 {approved} / {len(records)}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
