#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchRoot = path.join(root, 'data', 'research', 'nature-xhs-photos-2026-09-12');
const report = JSON.parse(await readFile(path.join(researchRoot, 'curated-report.json'), 'utf8'));
const outputRoot = path.join(researchRoot, 'qa-final');
const columns = 4;
const rows = 4;
const size = 300;
const labelHeight = 42;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const manifest = [];
for (let offset = 0; offset < report.records.length; offset += perSheet) {
  const batch = report.records.slice(offset, offset + perSheet);
  const composites = [];
  for (const [cell, record] of batch.entries()) {
    const left = (cell % columns) * size;
    const top = Math.floor(cell / columns) * (size + labelHeight);
    const image = await sharp(record.finalPath).resize(size, size, { fit: 'cover' }).jpeg({ quality: 94 }).toBuffer();
    const label = Buffer.from(`<svg width="${size}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111"/><text x="7" y="26" font-family="PingFang SC,Arial" font-size="13" fill="white">${escapeXml(`${offset + cell + 1}. [${record.index}] ${record.placeName}`)}</text></svg>`);
    composites.push({ input: image, left, top }, { input: label, left, top: top + size });
    manifest.push({ finalIndex: offset + cell + 1, sheet: Math.floor(offset / perSheet) + 1, ...record });
  }
  const sheet = Math.floor(offset / perSheet) + 1;
  await sharp({ create: { width: columns * size, height: rows * (size + labelHeight), channels: 3, background: '#ddd' } })
    .composite(composites).jpeg({ quality: 95 }).toFile(path.join(outputRoot, `sheet-${String(sheet).padStart(2, '0')}.jpg`));
}
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`final photos ${manifest.length}, sheets ${Math.ceil(manifest.length / perSheet)}\n`);
