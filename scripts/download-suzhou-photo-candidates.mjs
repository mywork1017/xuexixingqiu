#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchDir = path.resolve('data/research/suzhou-photo-reselect-2026-08-16');
const manifestPath = path.join(researchDir, 'source-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const results = [];

await fs.rm(path.join(researchDir, 'downloads'), { recursive: true, force: true });
for (const place of manifest.places) {
  const destinationDir = path.join(researchDir, 'downloads', place.id);
  await fs.mkdir(destinationDir, { recursive: true });
  for (const image of place.images) {
    const response = await fetch(image.url, {
      redirect: 'follow',
      headers: {
        Referer: place.sourcePage,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`${place.name} 下载失败：${response.status} ${image.url}`);
    const input = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 420) {
      throw new Error(`${place.name} 图片尺寸不足：${metadata.width || 0}×${metadata.height || 0}`);
    }
    const destination = path.join(destinationDir, image.file);
    await sharp(input).rotate().webp({ quality: 95 }).toFile(destination);
    results.push({ placeId: place.id, placeName: place.name, sourcePage: place.sourcePage, sourceUrl: image.url, path: path.relative(root, destination), width: metadata.width, height: metadata.height });
  }
}

await fs.writeFile(path.join(researchDir, 'download-report.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), images: results }, null, 2)}\n`);
console.log(JSON.stringify({ places: manifest.places.length, images: results.length }, null, 2));
