#!/usr/bin/env python3
"""Remove entrances, sub-POIs, roads, businesses and duplicate map discoveries."""

import json
import re
import sqlite3
from pathlib import Path


ROOT = Path("data/research/nature-expansion-2026-09-13")
SOURCE = ROOT / "map-discovery.json"
OUTPUT = ROOT / "curated-map-places.json"
DATABASE = Path("admin/prisma/dev.db")
CITY_LIMITS = {"苏州市": 120, "南通市": 70, "无锡市": 90, "嘉兴市": 70, "镇江市": 60}
CORE_TYPE = re.compile(r"公园$|湿地$|森林$|植物园$|风景区$|景区$|绿地$|绿廊$|风光带$|滨水空间$|绿道$|步道$|生态园$|湖$|山$|岛$|洲$|滩$|谷$|岭$|峰$|堤$")
REJECT_NAME = re.compile(
    r"(?:东|西|南|北|侧|号)?门$|入口|出口|停车|公交|地铁|游客中心|管理|售票|服务处|驿站|充电|酒店|宾馆|饭店|餐|咖啡|茶|酒吧|会所|"
    r"公司|集团|医院|学校|学院|大学|幼儿园|小区|住宅|花苑|家园|新城|社区|物业|商厦|商场|超市|银行|市场|"
    r"农庄|农业|果园|采摘|垂钓|渔业|草莓|葡萄|农场|乐园|动物园|水世界|婚庆|民宿|营地|露营|拓展|团建|"
    r"纪念馆|博物馆|寺|庙|塔|洞|泉|亭|桥|雕塑|广场店|管理站|交叉口|道路|大道$|公路$|路$|街$|村$|"
    r"建设中|暂停开放|内部|高尔夫|墓|陵园|公墓|主题馆|展览|观光车|码头|厕所|卫生间|卖品部|检票"
)
SUB_POI = re.compile(r"[-—](?!一期|二期|三期|四期)|(?:公园|景区|植物园|湿地|森林|绿道|步道)内|[（(](?:东|西|南|北|东北|西北|东南|西南)?(?:门|入口|出口|停车|地铁)")
PRIVATE_PLANT = re.compile(r"多肉植物园|食虫植物园|花木植物园|观赏植物园|名贵植物园|草药植物园|中草药植物园|恭喜发财植物园|漫生活植物园|热带植物园|芳香植物园|古樟植物园|水八仙植物园|沙生植物园|药用植物园")
NATURAL_SCENIC = re.compile(r"山|湖|河|江|海|港|湾|岛|洲|滩|湿地|森林|花谷|植物|公园|绿地|绿廊|风光带|滨水")
MANUAL_REJECT = {
    "植物园", "香山植物园", "南通颐和植物园", "张群农植物园", "无锡市轻工植物园", "花世界植物园", "万红花卉植物园",
    "盲人植物园", "海星植物园", "晶艺植物园", "湿地公园", "七里山塘景区", "虞山城墙景区", "苏苑公园",
    "通海垦牧旧址景区", "绿地长岛蝴蝶溪谷", "惠山古镇景区", "鸿山泰伯景区", "华西世界公园",
    "海宁中国皮革城景区", "茅山兵马俑景区", "黄山一号夜市公园", "赶海公园", "句容市茅山风景区肉嘟嘟多肉植物园",
}


def clean_name(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def normalized(value):
    return re.sub(r"(?:苏州|南通|无锡|嘉兴|镇江)市?|国家级?|省级?|[（）()\s·•_\-—]", "", clean_name(value))


def practical_description(item):
    name = clean_name(item["name"])
    address = clean_name(item["addressHint"]).replace("中国", "")
    if re.search(r"湿地|湖|滨水|滨江|滨河|湖滨|河畔|岛|洲|滩|堤", name):
        kind, detail = "滨水或湿地自然空间", "游览范围围绕水岸、湿地或连续户外空间展开"
    elif re.search(r"山|岭|峰|谷|森林|风景区|景区", name):
        kind, detail = "山林或自然游览空间", "游览对象以山林地貌、植被或自然景观为主"
    elif "植物园" in name:
        kind, detail = "植物展示与户外游览空间", "游览对象以植物展示和户外绿地为主"
    else:
        kind, detail = "面向公众的户外自然空间", "作为独立公园或绿地提供户外游览区域"
    return f"位于{address}，属于{kind}。{detail}，可按该地址导航至公开标注位置"


def distance_m(a, b):
    from math import asin, cos, radians, sin, sqrt
    lat1, lon1, lat2, lon2 = map(radians, [a["latitude"], a["longitude"], b["latitude"], b["longitude"]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    return 12742000 * asin(sqrt(sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2))


payload = json.loads(SOURCE.read_text(encoding="utf-8"))
connection = sqlite3.connect(DATABASE)
existing = [dict(zip([column[0] for column in cursor.description], row)) for cursor in [connection.execute(
    "SELECT id, name, address, latitude, longitude FROM Place WHERE category='自然'"
)] for row in cursor.fetchall()]
connection.close()

eligible = []
rejected = []
for item in payload["records"]:
    name, address = clean_name(item["name"]), clean_name(item["addressHint"])
    reason = ""
    if item.get("mapResult", {}).get("category") not in ("", "Park", "Beach"): reason = "non_nature_map_category"
    elif name in MANUAL_REJECT: reason = "manual_identity_or_scope_reject"
    elif not CORE_TYPE.search(name): reason = "weak_type"
    elif REJECT_NAME.search(name): reason = "excluded_name"
    elif PRIVATE_PLANT.search(name): reason = "private_or_subarea_plant_garden"
    elif re.search(r"(?<!公)生态园$", name): reason = "private_ecological_venue"
    elif re.search(r"景区$", name) and not NATURAL_SCENIC.search(name.replace("景区", "")): reason = "cultural_scenic_area"
    elif len(name) <= 3 and re.search(r"(?:山|湖|岛|洲|滩|谷|岭|峰|森林)$", name): reason = "ambiguous_natural_feature"
    elif SUB_POI.search(name) or SUB_POI.search(address): reason = "sub_poi"
    elif re.search(r"与.+交叉口", name): reason = "road_intersection"
    elif any(normalized(name) == normalized(row["name"]) for row in existing): reason = "existing_name"
    elif any(distance_m(item["mapResult"], row) < 45 and normalized(name) == normalized(row["name"]) for row in existing): reason = "existing_nearby"
    if reason:
        rejected.append({"city": item["city"], "name": name, "reason": reason})
    else:
        eligible.append({**item, "description": practical_description(item)})

deduped = []
for item in sorted(eligible, key=lambda value: (value["city"], value["district"], len(value["name"]), value["name"])):
    duplicate = next((kept for kept in deduped if kept["city"] == item["city"] and (
        normalized(kept["name"]) == normalized(item["name"])
        or (distance_m(kept["mapResult"], item["mapResult"]) < 55 and (
            normalized(kept["name"]) in normalized(item["name"]) or normalized(item["name"]) in normalized(kept["name"])
        ))
    )), None)
    if duplicate:
        rejected.append({"city": item["city"], "name": item["name"], "reason": "discovery_duplicate", "kept": duplicate["name"]})
    else:
        deduped.append(item)

selected = []
for city, limit in CITY_LIMITS.items():
    city_rows = [item for item in deduped if item["city"] == city]
    city_rows.sort(key=lambda item: (
        0 if re.search(r"国家|省级|森林公园|湿地公园|风景区|植物园", item["name"]) else 1,
        0 if re.search(r"公园$|风景区$|景区$|植物园$", item["name"]) else 1,
        item["district"], item["name"]
    ))
    selected.extend(city_rows[:limit])

result = {"source": str(SOURCE), "selected": selected, "rejected": rejected, "counts": {city: sum(item["city"] == city for item in selected) for city in CITY_LIMITS}}
OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"selected": len(selected), "counts": result["counts"], "rejected": len(rejected)}, ensure_ascii=False))
