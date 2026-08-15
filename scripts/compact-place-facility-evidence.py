#!/usr/bin/env python3
"""Build a compact review file from archived crawl pages without generating prose."""

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


FACILITY_TERMS = (
    "wifi", "wi-fi", "无线", "插座", "电源", "充电", "厕所", "卫生间", "洗手间",
    "饮水", "热水", "茶水", "楼层", "一楼", "二楼", "三楼", "四楼", "五楼", "六楼",
    "七楼", "八楼", "九楼", "十楼", "b1", "存包", "储物柜", "打印", "复印", "电梯",
    "无障碍", "停车", "母婴", "空调",
)
NOISE_TERMS = (
    "大家还在搜", "相关搜索", "百度一下", "登录查看", "使用前必读", "用户反馈", "下一页",
    "热搜榜", "智能插座", "插座怎么接", "插座图片", "插座品牌", "矿大图书馆", "广州图书馆",
    "百度为您找到以下结果", "去掉\"\"获得更多", "问题分析中", "百度图片", "最新消息",
    "安装步骤", "连接方法", "最简单三个步骤", "及价格",
    "更多关于", "精选笔记", "&rqid=", "%E5%", "%E6%", "%E7%", "%E8%", "%E9%",
)
SOURCE_TERMS = ("小红书", "大众点评", "高德", "百度地图", "政府", "官方", "图书馆", "文旅")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="admin/prisma/dev.db")
    parser.add_argument("--research-dir", default="data/research/facility-description-web-crawl-2026-08-09")
    parser.add_argument("--max-blocks", type=int, default=40)
    return parser.parse_args()


def load_places(database):
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(
            "SELECT id, name, category FROM Place ORDER BY rowid"
        )]


def normalize(value):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value.lower())


def place_aliases(name):
    values = {normalize(name)}
    without_parentheses = re.sub(r"[（(].*?[）)]", "", name)
    values.add(normalize(without_parentheses))
    return sorted((value for value in values if len(value) >= 4), key=len, reverse=True)


def clean_markdown_line(line):
    line = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", line)
    line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
    line = re.sub(r"https?://\S+", "", line)
    line = re.sub(r"[#_*|`]+", " ", line)
    return re.sub(r"\s+", " ", line).strip()


def page_query(lines):
    for index, line in enumerate(lines):
        if line.strip() == "# Query" and index + 2 < len(lines):
            return lines[index + 2].strip()
    return ""


def extract_blocks(path, place):
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    query = page_query(lines)
    aliases = place_aliases(place["name"])
    segments = []
    for line_number, raw_line in enumerate(lines, start=1):
        cleaned = clean_markdown_line(raw_line)
        for piece in re.split(r"(?<=[。！？!?；;])\s*|\s{2,}", cleaned):
            piece = piece.strip()
            if piece:
                segments.append((line_number, piece))
    blocks = []
    for index, (line_number, cleaned) in enumerate(segments):
        lowered = cleaned.lower()
        if not cleaned or any(term in cleaned for term in NOISE_TERMS):
            continue
        if query and normalize(cleaned) == normalize(query):
            continue
        matched_terms = sorted({term for term in FACILITY_TERMS if term in lowered})
        if not matched_terms:
            continue
        block = cleaned
        normalized_block = normalize(block)
        if not any(alias in normalized_block for alias in aliases):
            context = " ".join(
                segments[position][1]
                for position in range(max(0, index - 1), min(len(segments), index + 2))
            )
            if not any(alias in normalize(context) for alias in aliases):
                continue
            block = context
            normalized_block = normalize(block)
        if any(term in block for term in NOISE_TERMS):
            continue
        if len(block) < 20 or len(block) > 900:
            continue
        score = len(matched_terms) * 7
        score += max((len(alias) for alias in aliases if alias in normalized_block), default=0)
        score += sum(term.lower() in lowered for term in SOURCE_TERMS) * 4
        score += 4 if re.search(r"20\d{2}年|20\d{2}[-/.]", block) else 0
        score -= max(0, block.count("百度") - 2) * 2
        blocks.append({
            "score": score,
            "terms": matched_terms,
            "query": query,
            "rawPath": str(path),
            "line": line_number,
            "text": block,
        })
    unique = {}
    for block in blocks:
        key = normalize(block["text"][:500])
        if key not in unique or block["score"] > unique[key]["score"]:
            unique[key] = block
    return list(unique.values())


def main():
    args = parse_args()
    research_dir = Path(args.research_dir)
    raw_dir = research_dir / "raw-search-pages"
    source_paths_by_place = defaultdict(list)
    source_manifest = research_dir / "source-crawl-manifest.json"
    if source_manifest.exists():
        manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
        for record in manifest.get("records", []):
            raw_path = Path(record.get("rawPath", ""))
            if not raw_path.exists():
                continue
            for place_id in record.get("placeIds", []):
                source_paths_by_place[place_id].append(raw_path)
    evidence = []
    coverage = defaultdict(int)
    for place in load_places(args.database):
        paths = sorted(raw_dir.glob(f'{place["id"]}-*.md'))
        paths.extend(source_paths_by_place.get(place["id"], []))
        blocks = []
        for path in paths:
            blocks.extend(extract_blocks(path, place))
        blocks.sort(key=lambda item: (-item["score"], item["rawPath"], item["line"]))
        selected = blocks[:args.max_blocks]
        coverage[place["category"]] += bool(selected)
        evidence.append({**place, "evidenceCount": len(selected), "evidence": selected})
    output_path = research_dir / "facility-evidence-compact.json"
    output_path.write_text(json.dumps({
        "placeCount": len(evidence),
        "placesWithEvidence": sum(item["evidenceCount"] > 0 for item in evidence),
        "coverageByCategory": coverage,
        "places": evidence,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "places": len(evidence),
        "placesWithEvidence": sum(item["evidenceCount"] > 0 for item in evidence),
        "coverageByCategory": coverage,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
