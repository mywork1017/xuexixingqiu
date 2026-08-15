#!/usr/bin/env python3
"""Download every raster image discovered in archived Crawl4AI media metadata."""

import argparse
import asyncio
import hashlib
import io
import json
import mimetypes
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import aiohttp
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--research-dir",
        default="data/research/place-enrichment-web-crawl-2026-08-09",
    )
    parser.add_argument("--concurrency", type=int, default=12)
    parser.add_argument("--max-bytes", type=int, default=20 * 1024 * 1024)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def original_url_from_proxy(url):
    parsed = urlparse(url)
    if "sogoucdn.com" not in parsed.netloc:
        return ""
    nested = parse_qs(parsed.query).get("url", [""])[0]
    return unquote(nested) if nested.startswith(("http://", "https://")) else ""


def collect_images(research_dir):
    by_url = defaultdict(list)
    for path in sorted((research_dir / "pages").glob("**/result.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        place = record.get("place") or {}
        place_ids = place.get("references") or ([place.get("id")] if place.get("id") else [])
        referer = record.get("resultUrl") or record.get("requestedUrl") or ""
        for image in (record.get("media") or {}).get("images", []):
            url = image.get("src") or image.get("url") or ""
            if not url.startswith(("http://", "https://")):
                continue
            reference = {
                "archiveResult": str(path),
                "placeIds": place_ids,
                "referer": referer,
                "metadata": image,
                "kind": "extracted",
            }
            by_url[url].append(reference)
            original = original_url_from_proxy(url)
            if original:
                by_url[original].append({**reference, "kind": "proxy-original", "proxyUrl": url})
    return by_url


def extension_for(content_type, url, image_format):
    mapping = {
        "JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif",
        "AVIF": ".avif", "BMP": ".bmp", "TIFF": ".tif",
    }
    if image_format in mapping:
        return mapping[image_format]
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"):
        return ".jpg" if suffix == ".jpeg" else suffix
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ".img"
    return ".jpg" if guessed in (".jpe", ".jpeg") else guessed


async def download_all(args):
    research_dir = Path(args.research_dir)
    media_dir = research_dir / "media" / "original"
    media_dir.mkdir(parents=True, exist_ok=True)
    by_url = collect_images(research_dir)
    semaphore = asyncio.Semaphore(args.concurrency)
    timeout = aiohttp.ClientTimeout(total=60)
    connector = aiohttp.TCPConnector(limit=args.concurrency, ssl=False)
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36"
    }

    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        async def fetch(url, references):
            url_digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
            existing = list((media_dir / url_digest[:2]).glob(f"{url_digest}.*"))
            if existing and not args.refresh:
                path = existing[0]
                try:
                    with Image.open(path) as image:
                        width, height, image_format = image.width, image.height, image.format
                except Exception:
                    width, height, image_format = None, None, None
                return {
                    "url": url, "success": True, "cached": True,
                    "localPath": str(path), "bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "width": width, "height": height, "format": image_format,
                    "references": references,
                }
            async with semaphore:
                request_headers = {}
                referer = next((item.get("referer") for item in references if item.get("referer")), "")
                if referer:
                    request_headers["Referer"] = referer
                try:
                    async with session.get(url, headers=request_headers, allow_redirects=True) as response:
                        content_type = response.headers.get("Content-Type", "")
                        declared = int(response.headers.get("Content-Length", "0") or 0)
                        if declared > args.max_bytes:
                            raise ValueError(f"content length {declared} exceeds limit")
                        data = await response.read()
                        if len(data) > args.max_bytes:
                            raise ValueError(f"downloaded {len(data)} bytes exceeds limit")
                        if response.status >= 400:
                            raise ValueError(f"HTTP {response.status}")
                    with Image.open(io.BytesIO(data)) as image:
                        width, height, image_format = image.width, image.height, image.format
                        image.verify()
                    extension = extension_for(content_type, url, image_format)
                    directory = media_dir / url_digest[:2]
                    directory.mkdir(parents=True, exist_ok=True)
                    path = directory / f"{url_digest}{extension}"
                    path.write_bytes(data)
                    return {
                        "url": url, "success": True, "cached": False,
                        "statusCode": response.status, "contentType": content_type,
                        "localPath": str(path), "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "width": width, "height": height, "format": image_format,
                        "references": references,
                    }
                except Exception as error:
                    return {
                        "url": url, "success": False, "cached": False,
                        "error": str(error), "references": references,
                    }

        tasks = [asyncio.create_task(fetch(url, references)) for url, references in by_url.items()]
        records = []
        for task in asyncio.as_completed(tasks):
            record = await task
            records.append(record)
            print(json.dumps({
                "success": record["success"],
                "url": record["url"],
                "bytes": record.get("bytes", 0),
                "size": [record.get("width"), record.get("height")],
            }, ensure_ascii=False), flush=True)

    index_path = research_dir / "media-download-index.json"
    records.sort(key=lambda item: item["url"])
    index_path.write_text(json.dumps({
        "candidateCount": len(by_url),
        "downloadedCount": sum(item["success"] for item in records),
        "failedCount": sum(not item["success"] for item in records),
        "records": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "index": str(index_path),
        "candidates": len(by_url),
        "downloaded": sum(item["success"] for item in records),
        "failed": sum(not item["success"] for item in records),
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(download_all(parse_args()))
