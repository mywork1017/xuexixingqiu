#!/usr/bin/env python3
"""Extract structured non-Shanghai candidates from archived official source pages."""

import json
import re
from pathlib import Path


ROOT = Path("data/research/nature-places-2026-09-12")
PAYLOAD_PATH = ROOT / "candidates.json"


def clean(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def record(name, city, district="", address_hint="", description="", source_index=0):
    return {
        "sourceId": "",
        "name": clean(name),
        "category": "自然",
        "city": city,
        "district": district,
        "addressHint": clean(address_hint),
        "hours": "",
        "description": clean(description).rstrip("。"),
        "photoCandidates": [],
        "sourceIndex": source_index,
    }


def parse_nantong(markdown, source_index):
    rows = []
    district = ""
    district_map = {
        "市本级": "崇川区", "海安": "海安市", "如皋": "如皋市", "如东": "如东县",
        "启东": "启东市", "崇川区": "崇川区", "通州区": "通州区", "海门区": "海门区",
        "开发区": "南通开发区", "通州湾示范区": "通州湾示范区", "创新区": "崇川区", "濠河景区": "崇川区",
    }
    for line in markdown.splitlines():
        cells = [item.strip(" *") for item in line.split("|")]
        if len(cells) < 9 or not any(term in line for term in ("公园绿地", "闲置地块")):
            continue
        if cells[0] in district_map:
            district = district_map[cells.pop(0)]
        name, location, place_type, area, shared_type = cells[:5]
        if name in ("绿地名称", ""):
            continue
        description = f"公开名录标注为{place_type}，总面积{area}平方米，开放共享区域包含{shared_type}"
        rows.append(record(name, "南通市", district, location, description, source_index))
    return rows


def parse_wuxi(markdown, source_index):
    rows = []
    position = 0
    for line in markdown.splitlines():
        match = re.match(r"\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*", line)
        if not match:
            continue
        position += 1
        name, shared_type, area = match.group(2).strip(), match.group(3).strip(), match.group(4)
        district = "江阴市" if 26 <= position <= 38 else "宜兴市" if position >= 39 else ""
        description = f"公开共享区域包含{shared_type}，名录记录开放面积{area}平方米"
        rows.append(record(name, "无锡市", district, "", description, source_index))
    return rows


def suzhou_records(source_index):
    facts = {
        "苏州公园": "已完成无界公园改造，园内树木设有植物科普信息码",
        "桐泾公园": "已完成无界公园改造，公园空间与城市街道相连",
        "东园": "拆除沿街围墙并完成升级，园内有开放草坪",
        "双亭园口袋公园": "设有漏窗、月洞门、亭台、花街铺地和太湖石景观",
        "桂花公园": "园内树木设有植物科普信息码",
        "万公堤": "依托东太湖天然湖岸和传统溇港建设，入选江苏开放共享公园绿地清单",
        "吴江公园": "位于东太湖度假区，入选江苏开放共享公园绿地清单",
        "芦荡湖湿地公园": "位于东太湖度假区，入选江苏开放共享公园绿地清单",
        "东太湖生态园": "依托天然湖岸和乡土植物建设，入选江苏开放共享公园绿地清单",
        "胜地生态公园": "位于东太湖度假区，入选江苏开放共享公园绿地清单",
        "苏州湾体育公园": "位于东太湖湖滨，湿地鸟类在该区域集中分布",
        "太湖绿洲湿地公园": "监测记录累计178种鸟类，是东太湖湿地鸟类集中分布区",
    }
    return [record(name, "苏州市", "", "", description, source_index) for name, description in facts.items()]


def jiaxing_records(source_index):
    values = [
        ("府南公园", "嘉兴经开区", "珠庵路南侧", "占地约3.7万平方米，两面环水，设有廊亭、临河健身步道、大草坪和儿童游乐场"),
        ("新区中央公园（二期）", "嘉善县", "白水塘路南北两侧，嘉善大路以西，万联路以东", "占地约11.49万平方米，设有水杉林、银杏林和枫香林，兼具休闲、健身和防灾避险功能"),
        ("明湖公园", "平湖市", "东至大胜路和文蔚路，南至怀橘路，西至新华南路，北至池海路", "总占地约59.9万平方米，其中水域约18.9万平方米，绿化约28.86万平方米"),
        ("观海园", "海盐县", "南台头闸东北、老沪杭公路东侧", "2003年建成，公园东临杭州湾，依海建设，园路围绕起伏地形和植被展开"),
        ("赞山公园", "海宁市", "东临碧云路、北至文新路、西南连赞山港", "总面积约10.6万平方米，景观结合良渚文化遗址和法制文化主题"),
        ("桐乡植物园", "桐乡市", "东南西北均至环园路", "占地约20.66万平方米，栽植200多个植物品种，划分竹园、万松林、茶花山和银杏林等专类园"),
        ("汤山公园", "嘉兴港区", "汤山西侧、滨海大道和天妃路交叉口", "占地约17.2万平方米，设有天妃宫炮台、天妃宫广场和莲心亭，园内水系、绿地和建筑相互衔接"),
    ]
    return [record(name, "嘉兴市", district, address, description, source_index) for name, district, address, description in values]


def zhenjiang_records(source_index):
    names = [
        "四平山公园", "断山墩遗址公园", "心湖公园", "丁卯科技园公园", "观塘路水系公园", "丹徒区国防主题公园",
        "西二环城市花园", "三女墩遗址公园", "香溪湾口袋公园", "文昌苑口袋公园", "句容河两侧风光带", "汪家小埭公园",
        "北固山景区", "滨江风光带", "焦山景区", "古城公园", "海绵公园", "谏壁公园", "狮子山公园", "宝盖山公园",
        "金山景区", "赛珍珠公园", "龙湖公园", "白龙山公园", "龙脉团山公园", "凤凰山公园", "团结河风光带", "北湖公园", "南湖公园", "郁金香公园", "银山公园", "瑞湖公园", "大港河风光带",
    ]
    description = "纳入当地公园绿地绿线或开放共享城市绿地名单，对公众提供林下、草坪或滨水活动空间"
    return [record(name, "镇江市", "", "", description, source_index) for name in names]


payload = json.loads(PAYLOAD_PATH.read_text(encoding="utf-8"))
sources = payload["sources"]
source_index = {(item["city"], item["title"]): index for index, item in enumerate(sources)}
supplemental = []
supplemental += suzhou_records(source_index[("苏州市", "向绿而行，苏州的当下与未来")])
supplemental += parse_nantong((ROOT / "supplemental-03-南通市.md").read_text(encoding="utf-8"), source_index[("南通市", "南通市第二批开放共享城市绿地清单")])
supplemental += parse_wuxi((ROOT / "supplemental-04-无锡市.md").read_text(encoding="utf-8"), source_index[("无锡市", "无锡市第二批开放共享公园绿地名录")])
supplemental += jiaxing_records(source_index[("嘉兴市", "第二届嘉兴市最美公园候选名单")])
supplemental += zhenjiang_records(source_index[("镇江市", "江苏首批开放共享公园绿地")])

unique = {(item["city"], item["name"]): item for item in [*payload["candidates"], *supplemental]}
payload["candidates"] = list(unique.values())
payload["countsByCity"] = {}
for item in payload["candidates"]:
    payload["countsByCity"][item["city"]] = payload["countsByCity"].get(item["city"], 0) + 1
PAYLOAD_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"candidates": len(payload["candidates"]), "countsByCity": payload["countsByCity"]}, ensure_ascii=False))
