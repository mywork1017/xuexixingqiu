#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchRoot = path.join(root, 'data', 'research', 'nature-web-photos-shanghai-2026-09-12');
const source = JSON.parse(await readFile(path.join(researchRoot, 'qa', 'manifest.json'), 'utf8'));
const outputRoot = path.join(root, 'admin', 'public', 'uploads', 'nature-web-shanghai-final-2026-09-12');
const approvedIndexes = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17, 19, 23, 24, 25,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 47, 48, 49,
  50, 51, 52, 54, 55, 56, 57, 58, 60, 63, 64, 65, 66, 69, 70,
  71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
  88, 89, 90, 91, 93, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
  107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 121,
  122, 123, 125, 126, 127, 128, 129, 130, 132, 133, 134, 145, 146, 147,
  148, 149, 150
]);
const records = source.filter((record) => approvedIndexes.has(record.index));
if (records.length !== approvedIndexes.size) throw new Error('Approved Shanghai web image is missing');

await rm(outputRoot, { recursive: true, force: true });
const placeCounts = new Map();
for (const record of records) {
  const input = path.resolve(root, record.url);
  const metadata = await sharp(input).metadata();
  const insetX = Math.round(metadata.width * 0.07);
  const insetY = Math.round(metadata.height * 0.07);
  const ordinal = (placeCounts.get(record.placeId) || 0) + 1;
  placeCounts.set(record.placeId, ordinal);
  const placeRoot = path.join(outputRoot, record.placeId);
  await mkdir(placeRoot, { recursive: true });
  const filename = `${String(ordinal).padStart(2, '0')}.webp`;
  const finalPath = path.join(placeRoot, filename);
  await sharp(input)
    .extract({ left: insetX, top: insetY, width: metadata.width - insetX * 2, height: metadata.height - insetY * 2 })
    .resize(1024, 1024, { fit: 'cover' })
    .webp({ quality: 87, effort: 5 })
    .toFile(finalPath);
  record.finalPath = finalPath;
  record.publicUrl = `/uploads/nature-web-shanghai-final-2026-09-12/${record.placeId}/${filename}`;
  record.contentHash = createHash('sha256').update(await readFile(finalPath)).digest('hex');
}

const report = { generatedAt: new Date().toISOString(), photos: records.length, places: placeCounts.size, records };
await writeFile(path.join(researchRoot, 'curated-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ photos: records.length, places: placeCounts.size }, null, 2)}\n`);
