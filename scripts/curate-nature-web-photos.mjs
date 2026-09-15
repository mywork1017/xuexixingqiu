#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchRoot = path.join(root, 'data', 'research', 'nature-web-photos-2026-09-12');
const source = JSON.parse(await readFile(path.join(researchRoot, 'qa', 'manifest.json'), 'utf8'));
const outputRoot = path.join(root, 'admin', 'public', 'uploads', 'nature-web-final-2026-09-12');
const approvedIndexes = new Set([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 19, 20, 21, 25, 26, 27,
  28, 29, 30, 33, 35, 36, 37, 38, 41, 42, 43, 44, 48, 52, 53, 54, 55,
  56, 57, 59, 60, 61, 62, 63, 68, 69, 71, 76, 77, 80, 81, 82, 83,
  84, 86, 87, 91, 92
]);
const records = source.filter((record) => approvedIndexes.has(record.index));
if (records.length !== approvedIndexes.size) throw new Error('Approved web image is missing');
await rm(outputRoot, { recursive: true, force: true });
const placeCounts = new Map();
for (const record of records) {
  const input = path.resolve(root, record.url);
  const metadata = await sharp(input).metadata();
  const insetX = Math.round(metadata.width * 0.06);
  const insetY = Math.round(metadata.height * 0.06);
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
  record.publicUrl = `/uploads/nature-web-final-2026-09-12/${record.placeId}/${filename}`;
  record.contentHash = createHash('sha256').update(await readFile(finalPath)).digest('hex');
}
const report = { generatedAt: new Date().toISOString(), photos: records.length, places: placeCounts.size, records };
await writeFile(path.join(researchRoot, 'curated-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ photos: records.length, places: placeCounts.size }, null, 2)}\n`);
