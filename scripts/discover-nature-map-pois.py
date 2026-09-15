#!/usr/bin/env python3
"""Discover public nature POIs from Apple Maps China district searches."""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright


OUTPUT_ROOT = Path("data/research/nature-expansion-2026-09-13")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CITIES = {
    "苏州市": {
        "center": (31.30, 120.58), "span": (1.4, 1.8), "bounds": (30.7, 32.1, 119.8, 121.3),
        "districts": ["姑苏区", "虎丘区", "吴中区", "相城区", "吴江区", "苏州工业园区", "常熟市", "张家港市", "昆山市", "太仓市"],
    },
    "南通市": {
        "center": (32.05, 120.9), "span": (1.4, 1.8), "bounds": (31.55, 32.75, 120.2, 122.05),
        "districts": ["崇川区", "通州区", "海门区", "海安市", "如东县", "启东市", "如皋市"],
    },
    "无锡市": {
        "center": (31.55, 120.3), "span": (1.1, 1.3), "bounds": (31.05, 32.1, 119.45, 120.75),
        "districts": ["梁溪区", "锡山区", "惠山区", "滨湖区", "新吴区", "江阴市", "宜兴市"],
    },
    "嘉兴市": {
        "center": (30.75, 120.75), "span": (0.9, 1.1), "bounds": (30.25, 31.05, 120.3, 121.35),
        "districts": ["南湖区", "秀洲区", "嘉善县", "海盐县", "海宁市", "平湖市", "桐乡市"],
    },
    "镇江市": {
        "center": (32.1, 119.4), "span": (1.0, 1.2), "bounds": (31.55, 32.4, 118.9, 119.95),
        "districts": ["京口区", "润州区", "丹徒区", "丹阳市", "扬中市", "句容市"],
    },
}
SEARCH_TERMS = ["公园", "湿地公园", "森林公园", "风景区", "景区", "湖", "山", "滨江", "滨河", "绿道", "植物园", "生态园"]
NATURE_NAME = re.compile(r"公园|绿地|绿廊|风光带|景观带|滨水|滨江|滨河|湖滨|河畔|湿地|森林|游园|生态园|风景区|景区|步道|绿道|植物园|花谷|绿洲|海滨|沙滩|郊野|(?:山|湖|岛|洲|滩|谷|岭|峰|堤)$")
EXCLUDED = re.compile(r"小区|住宅|学校|学院|大学|酒店|宾馆|饭店|餐厅|公司|集团|高尔夫|墓园|陵园|公墓|停车场|服务区|管理处|售票处|游客中心|入口|出口|码头|商场|广场酒店")


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
            else resolve(data.places.slice(0, 20).map((item) => ({
              name: item.name || '', address: item.formattedAddress || '',
              latitude: item.coordinate.latitude, longitude: item.coordinate.longitude,
              category: item.pointOfInterestCategory || ''
            })));
          }));
        }""",
        {"query": query, "center": config["center"], "span": config["span"]},
    )


def acceptable(city, district, item, config):
    name = re.sub(r"\s+", "", item.get("name", ""))
    address = re.sub(r"\s+", "", item.get("address", ""))
    south, north, west, east = config["bounds"]
    inside = south <= float(item["latitude"]) <= north and west <= float(item["longitude"]) <= east
    location_match = city.rstrip("市") in address or district in address
    return inside and location_match and bool(NATURE_NAME.search(name)) and not EXCLUDED.search(name)


def description_for(item):
    name = item["name"]
    address = item["address"].replace("中国", "")
    if re.search(r"湿地|湖|滨水|滨江|滨河|湖滨|河畔|岛|洲|滩|堤", name):
        kind = "滨水或湿地自然空间"
    elif re.search(r"山|岭|峰|谷|森林|风景区|景区", name):
        kind = "山林或自然游览空间"
    elif "植物园" in name:
        kind = "植物展示与户外游览空间"
    else:
        kind = "面向公众的户外自然空间"
    if "公园" in name:
        detail = "作为独立城市公园提供绿地与户外游览区域"
    elif re.search(r"山|岭|峰|谷|森林|风景区|景区", name):
        detail = "游览对象以山林地貌、植被或自然景观为主"
    else:
        detail = "游览范围围绕水岸、湿地、植物或连续户外空间展开"
    return f"位于{address}，属于{kind}。{detail}，可按该地址导航至公开标注位置".rstrip("。")


async def main():
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    queries = []
    records = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=CHROME)
        page = await browser.new_page(locale="zh-CN")
        await page.goto("https://maps.apple.com.cn/search?query=x&center=31.5,120.4&span=2,3", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        for city, config in CITIES.items():
            for district in config["districts"]:
                for term in SEARCH_TERMS:
                    query = f"{city} {district} {term}"
                    try:
                        results = await apple_search(page, query, config)
                        accepted = [item for item in results if acceptable(city, district, item, config)]
                        queries.append({"query": query, "city": city, "district": district, "success": True, "results": len(results), "accepted": len(accepted)})
                        for item in accepted:
                            key = (city, re.sub(r"[（）()\s·•_\-—]", "", item["name"]), round(float(item["latitude"]), 5), round(float(item["longitude"]), 5))
                            records[key] = {
                                "sourceId": hashlib.sha256("|".join(map(str, key)).encode()).hexdigest()[:24],
                                "name": item["name"].strip(), "category": "自然", "city": city,
                                "district": district, "addressHint": item["address"].replace("中国", "").strip(),
                                "hours": "", "description": description_for(item), "photoCandidates": [],
                                "sourceUrl": f"https://maps.apple.com.cn/place?coordinate={item['latitude']},{item['longitude']}&name={item['name']}",
                                "sourceTitle": "Apple 地图中国区公开 POI", "status": "approved",
                                "mapResult": {**item, "accepted": True, "insideCity": True, "nameMatch": True, "districtMatch": True, "acceptanceBasis": "map_discovery_exact_poi"},
                                "discoveryQueries": [query],
                            }
                    except Exception as error:
                        queries.append({"query": query, "city": city, "district": district, "success": False, "error": str(error)})
                    await page.wait_for_timeout(100)
            print(city, sum(record["city"] == city for record in records.values()), flush=True)
        await browser.close()
    payload = {"generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Apple 地图中国区（高德底图）", "queries": queries, "records": list(records.values())}
    (OUTPUT_ROOT / "map-discovery.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {city: sum(item["city"] == city for item in records.values()) for city in CITIES}
    print(json.dumps({"records": len(records), "counts": counts}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
