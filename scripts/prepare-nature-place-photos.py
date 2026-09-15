#!/usr/bin/env python3
"""Download official nature-place photos and prepare square WebP candidates."""

import argparse
import asyncio
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from PIL import Image, ImageOps


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-dir", default="data/research/nature-places-2026-09-12")
    parser.add_argument("--uploads-dir", default="admin/public/uploads/nature-2026-09-12")
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--min-short-side", type=int, default=640)
    parser.add_argument("--report-name", default="photo-preparation-report.json")
    parser.add_argument("--border-crop", type=float, default=0)
    return parser.parse_args()


def photo_key(place):
    return hashlib.sha256(f"{place['city']}|{place['name']}".encode()).hexdigest()[:24]


def prepare_image(data, min_short_side, border_crop):
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGB")
    original = image.copy()
    width, height = image.size
    if min(width, height) < min_short_side:
        raise ValueError(f"short edge below {min_short_side}: {width}x{height}")
    if max(width, height) / min(width, height) > 3.2:
        raise ValueError(f"extreme aspect ratio: {width}x{height}")
    if image.resize((64, 64)).entropy() < 3.2:
        raise ValueError("low visual entropy")
    if border_crop:
        inset_x = round(width * border_crop)
        inset_y = round(height * border_crop)
        image = image.crop((inset_x, inset_y, width - inset_x, height - inset_y))
    square = ImageOps.fit(image, (1024, 1024), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    output = io.BytesIO()
    square.save(output, "WEBP", quality=88, method=6)
    return original, output.getvalue(), width, height


async def main():
    args = parse_args()
    research_dir = Path(args.research_dir)
    originals_dir = research_dir / "photo-originals"
    uploads_dir = Path(args.uploads_dir)
    originals_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    payload = json.loads((research_dir / "geocoded-candidates.json").read_text(encoding="utf-8"))
    places = [item for item in payload["records"] if item["status"] == "approved" and item.get("photoCandidates")]
    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://web.lhsr.sh.gov.cn/citymap/garden/index"}
    results = []

    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=60) as client:
        async def prepare(place):
            candidate = place["photoCandidates"][0]
            key = photo_key(place)
            original_path = originals_dir / f"{key}.jpg"
            final_path = uploads_dir / f"{key}.webp"
            try:
                async with semaphore:
                    response = await client.get(candidate["url"])
                response.raise_for_status()
                image, prepared, width, height = prepare_image(response.content, args.min_short_side, args.border_crop)
                image.save(original_path, "JPEG", quality=94)
                final_path.write_bytes(prepared)
                return {
                    "city": place["city"], "name": place["name"], "status": "prepared",
                    "sourcePage": candidate["sourcePage"], "originalUrl": candidate["url"],
                    "identityBasis": candidate["identityBasis"], "originalPath": str(original_path),
                    "finalPath": str(final_path), "publicUrl": f"/uploads/nature-2026-09-12/{final_path.name}",
                    "originalWidth": width, "originalHeight": height,
                    "contentHash": hashlib.sha256(response.content).hexdigest(),
                }
            except Exception as error:
                return {"city": place["city"], "name": place["name"], "status": "rejected", "reason": str(error),
                        "sourcePage": candidate["sourcePage"], "originalUrl": candidate["url"]}

        for start in range(0, len(places), args.concurrency):
            batch = await asyncio.gather(*(prepare(place) for place in places[start:start + args.concurrency]))
            results.extend(batch)
            print(f"{len(results)}/{len(places)} prepared={sum(item['status'] == 'prepared' for item in results)}", flush=True)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(), "places": len(places),
        "prepared": sum(item["status"] == "prepared" for item in results),
        "rejected": sum(item["status"] == "rejected" for item in results), "records": results,
    }
    (research_dir / args.report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("places", "prepared", "rejected")}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
