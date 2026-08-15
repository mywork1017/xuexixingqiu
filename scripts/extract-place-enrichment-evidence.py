#!/usr/bin/env python3
"""Build compact field candidates from the full raw enrichment archive."""

import argparse
import importlib.util
import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


FACILITY_TERMS = (
    "wifi", "wi-fi", "无线网", "插座", "电源", "充电", "厕所", "卫生间", "洗手间",
    "饮水", "热水", "茶水", "存包", "储物柜", "打印", "复印", "电梯", "无障碍",
    "停车", "母婴", "空调", "一楼", "二楼", "三楼", "四楼", "五楼", "六楼",
    "七楼", "八楼", "九楼", "十楼", "b1", "地下一层", "座位", "桌位",
    "席位", "儿童区", "少儿区", "母婴室", "咖啡", "餐厅", "微波炉",
    "健身房", "活动室", "电脑", "计算机", "自助借还", "消毒机", "露台",
    "休息室", "影音", "电影",
)
TIME_CONTEXT = re.compile(r"开放时间|营业时间|服务时间|供餐时间|周[一二三四五六日天]|每天|每日|上午|下午|早餐|午餐|晚餐")
TIME_VALUE = re.compile(r"(?:[01]?\d|2[0-4])\s*[:：]\s*[0-5]\d")
ADDRESS_CONTEXT = re.compile(r"地址|位于|坐落|设在|地处|入口")
ADDRESS_VALUE = re.compile(r"(?:路|街|道|巷|弄|号|楼|层|室|中心|广场|大厦|园区)")
NOISE = re.compile(r"相关搜索|大家还在搜|意见反馈|登录查看|搜索工具|热搜榜|ICP备|隐私政策")
SEARCH_NOISE = re.compile(
    r"百度为您找到|百度一下|去掉.*获得更多|搜索结果|推荐您搜索|看看元宝|"
    r"问题分析中|百度图片|时间不限所有网页|买燃油车|电动汽车|延长壳牌"
)
FACILITY_ASSERTION = re.compile(
    r"有|无|没有|未设|不设|不提供|配有|配置|提供|支持|可以|可用|可使用|"
    r"位于|入口|在.{0,12}(?:楼|层)|分布在"
)
HOURS_ASSERTION = re.compile(
    r"(?:开放时间|营业时间|服务时间|供餐时间)[^。；;\n]{0,80}"
    r"(?:[01]?\d|2[0-4])\s*[:：]\s*[0-5]\d"
)
ADDRESS_ASSERTION = re.compile(
    r"(?:地址|位于|坐落|设在|地处)[^。；;\n]{0,120}"
    r"(?:路|街|道|巷|弄|号|楼|层|室|中心|广场|大厦|园区)"
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument(
        "--research-dir",
        default="data/research/place-enrichment-web-crawl-2026-08-09",
    )
    parser.add_argument("--max-candidates-per-kind", type=int, default=80)
    return parser.parse_args()


def load_request_key():
    path = Path(__file__).with_name("crawl-place-enrichment.py")
    spec = importlib.util.spec_from_file_location("place_enrichment_archive", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.request_key


def load_places(database):
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(
            "SELECT id, name, category, address, latitude, longitude, hours, description FROM Place ORDER BY rowid"
        )]


def clean_line(line):
    line = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", line)
    line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
    line = re.sub(r"https?://\S+", "", line)
    line = re.sub(r"[#_*|`]+", " ", line)
    return re.sub(r"\s+", " ", line).strip()


def aliases(name):
    values = {
        re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", name.lower()),
        re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", re.sub(r"[（(].*?[）)]", "", name).lower()),
        re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", re.sub(r"[（）()]", "", name).lower()),
    }
    return [value for value in values if len(value) >= 4]


def normalize(value):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value.lower())


def markdown_path(result_path):
    directory = result_path.parent
    for name in ("raw_markdown.md", "raw.md", "markdown_with_citations.md", "fit_markdown.md"):
        path = directory / name
        if path.is_file():
            return path
    return None


def append_unique(bucket, item, limit):
    key = normalize(item["text"][:800])
    if not key or any(existing[0] == key for existing in bucket):
        return
    if len(bucket) < limit:
        bucket.append((key, item))


def main():
    args = parse_args()
    request_key = load_request_key()
    research_dir = Path(args.research_dir)
    places = load_places(args.database)
    places_by_id = {place["id"]: place for place in places}
    evidence = {
        place["id"]: {
            **place,
            "addressCandidates": [],
            "hoursCandidates": [],
            "facilityCandidates": [],
            "mediaCandidates": [],
        } for place in places
    }
    rejected_mapping_count = 0
    accepted_page_count = 0
    for result_path in sorted((research_dir / "pages").glob("**/result.json")):
        record = json.loads(result_path.read_text(encoding="utf-8"))
        requested = record.get("requestedUrl", "")
        result_url = record.get("resultUrl", "")
        if requested and result_url:
            try:
                if request_key(requested) != request_key(result_url):
                    rejected_mapping_count += 1
                    continue
            except Exception:
                rejected_mapping_count += 1
                continue
        place_record = record.get("place") or {}
        place_ids = place_record.get("references") or ([place_record.get("id")] if place_record.get("id") else [])
        place_ids = [place_id for place_id in place_ids if place_id in places_by_id]
        if not place_ids:
            continue
        accepted_page_count += 1
        path = markdown_path(result_path)
        lines = []
        if path:
            lines = [clean_line(line) for line in path.read_text(encoding="utf-8", errors="replace").splitlines()]
        normalized_page = normalize(" ".join(lines))
        for place_id in place_ids:
            place = places_by_id[place_id]
            place_aliases = aliases(place["name"])
            if not any(alias in normalized_page for alias in place_aliases):
                continue
            for index, line in enumerate(lines):
                if not line or NOISE.search(line):
                    continue
                context = " ".join(value for value in lines[max(0, index - 1):index + 2] if value)
                is_source_page = record.get("phase") == "sources"
                if not is_source_page and SEARCH_NOISE.search(context):
                    continue
                normalized_context = normalize(context)
                if (
                    (not is_source_page or len(place_ids) > 1)
                    and not any(alias in normalized_context for alias in place_aliases)
                ):
                    continue
                item = {
                    "text": context[:2400],
                    "channel": record.get("channel", ""),
                    "sourceUrl": record.get("resultUrl") or record.get("requestedUrl", ""),
                    "archiveResult": str(result_path),
                    "archiveText": str(path) if path else "",
                    "line": index + 1,
                }
                lowered = context.lower()
                if (
                    ADDRESS_CONTEXT.search(context)
                    and ADDRESS_VALUE.search(context)
                    and (is_source_page or ADDRESS_ASSERTION.search(context))
                ):
                    append_unique(evidence[place_id]["addressCandidates"], item, args.max_candidates_per_kind)
                if (
                    TIME_CONTEXT.search(context)
                    and TIME_VALUE.search(context)
                    and (is_source_page or HOURS_ASSERTION.search(context))
                ):
                    append_unique(evidence[place_id]["hoursCandidates"], item, args.max_candidates_per_kind)
                terms = sorted({term for term in FACILITY_TERMS if term in lowered})
                if terms and (is_source_page or FACILITY_ASSERTION.search(context)):
                    append_unique(
                        evidence[place_id]["facilityCandidates"],
                        {**item, "terms": terms},
                        args.max_candidates_per_kind,
                    )
            for image in (record.get("media") or {}).get("images", []):
                evidence[place_id]["mediaCandidates"].append({
                    "channel": record.get("channel", ""),
                    "sourceUrl": record.get("resultUrl") or record.get("requestedUrl", ""),
                    "archiveResult": str(result_path),
                    "image": image,
                })

    output = []
    for place in places:
        item = evidence[place["id"]]
        for key in ("addressCandidates", "hoursCandidates", "facilityCandidates"):
            item[key] = [entry for _, entry in item[key]]
        output.append(item)
    output_path = research_dir / "place-enrichment-evidence.json"
    output_path.write_text(json.dumps({
        "placeCount": len(output),
        "acceptedPageCount": accepted_page_count,
        "rejectedMappingCount": rejected_mapping_count,
        "coverage": {
            "address": sum(bool(item["addressCandidates"]) for item in output),
            "hours": sum(bool(item["hoursCandidates"]) for item in output),
            "facilities": sum(bool(item["facilityCandidates"]) for item in output),
            "media": sum(bool(item["mediaCandidates"]) for item in output),
        },
        "places": output,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "places": len(output),
        "acceptedPages": accepted_page_count,
        "rejectedMappings": rejected_mapping_count,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
