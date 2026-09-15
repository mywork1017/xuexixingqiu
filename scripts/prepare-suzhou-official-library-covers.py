#!/usr/bin/env python3
"""Download current official Suzhou Library venue images for manual review."""

from __future__ import annotations

import argparse
import io
import json
import re
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


BASE = "https://www.szlib.com"
MAIN = {
    "苏州图书馆": "/assets/rmlgFirstLinePic.5ed89e52.png",
    "苏州图书馆北馆": "/assets/beiguanFirstLinePic.7ea51bcf.png",
}


def safe_name(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", value).strip("-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--locations", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir)
    originals = output / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    payload = json.loads(Path(args.locations).read_text())
    rows = [(item["title"], item["cover_image_url"]) for item in payload["items"] if item.get("cover_image_url")]
    rows.extend(MAIN.items())
    review = []
    for index, (title, path) in enumerate(rows, 1):
        url = BASE + path
        ext = Path(path).suffix.lower() or ".jpg"
        target = originals / f"{index:03d}-{safe_name(title)}{ext}"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": BASE + "/"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            image = Image.open(io.BytesIO(data)).convert("RGB")
            image.save(target, quality=95)
            review.append({"index": index, "title": title, "url": url, "path": str(target), "width": image.width, "height": image.height})
        except Exception as exc:
            review.append({"index": index, "title": title, "url": url, "error": str(exc)})

    font = ImageFont.load_default()
    valid = [row for row in review if "path" in row]
    for page, start in enumerate(range(0, len(valid), 20), 1):
        canvas = Image.new("RGB", (1600, 5 * 250), "white")
        draw = ImageDraw.Draw(canvas)
        for slot, row in enumerate(valid[start : start + 20]):
            x = (slot % 4) * 400
            y = (slot // 4) * 250
            image = Image.open(row["path"]).convert("RGB")
            fitted = ImageOps.contain(image, (380, 205))
            canvas.paste(fitted, (x + (380 - fitted.width) // 2, y + 5))
            draw.text((x + 8, y + 214), f'{row["index"]} {row["title"]}', fill="black", font=font)
        canvas.save(output / f"review-{page:02d}.jpg", quality=92)
    (output / "report.json").write_text(json.dumps(review, ensure_ascii=False, indent=2))
    print(json.dumps({"downloaded": len(valid), "failed": len(review) - len(valid), "sheets": (len(valid) + 19) // 20}, ensure_ascii=False))


if __name__ == "__main__":
    main()
