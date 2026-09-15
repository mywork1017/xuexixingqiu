#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const sourceDir = path.resolve(process.argv[2] || 'data/research/suzhou-photo-refresh-2026-08-16/xhs');
const outputDir = path.resolve(process.argv[3] || 'data/research/suzhou-photo-refresh-2026-08-16/xhs-qa');
const manifest = JSON.parse(await readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
const columns = 4;
const rows = 3;
const imageSize = 300;
const labelHeight = 90;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const candidates = [];
for (const placeRecord of manifest.places) {
  const noteById = new Map(placeRecord.notes.map((note) => [note.id, note]));
  for (const image of placeRecord.images.filter((item) => !item.rejected)) {
    candidates.push({
      placeId: placeRecord.place.id,
      placeName: placeRecord.place.name,
      sourcePath: path.join(sourceDir, placeRecord.place.id, image.filename),
      filename: image.filename,
      note: noteById.get(image.noteId) || {},
      width: image.width,
      height: image.height,
    });
  }
}

const index = [];
for (let start = 0; start < candidates.length; start += perSheet) {
  const batch = candidates.slice(start, start + perSheet);
  const composites = [];
  for (const [cellIndex, candidate] of batch.entries()) {
    const x = (cellIndex % columns) * imageSize;
    const y = Math.floor(cellIndex / columns) * (imageSize + labelHeight);
    const preview = await sharp(candidate.sourcePath)
      .resize(imageSize, imageSize, { fit: 'contain', background: '#1b1b1b' })
      .webp({ quality: 84 })
      .toBuffer();
    const label = Buffer.from(`<svg width="${imageSize}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#fff"/>
      <text x="8" y="22" font-size="15" font-family="sans-serif" fill="#111">${escapeXml(`${start + cellIndex + 1}. ${candidate.placeName}`)}</text>
      <text x="8" y="45" font-size="12" font-family="sans-serif" fill="#444">${escapeXml(candidate.filename)} · ${candidate.width}×${candidate.height}</text>
      <text x="8" y="68" font-size="12" font-family="sans-serif" fill="#666">${escapeXml((candidate.note.title || '').slice(0, 35))}</text>
    </svg>`);
    composites.push({ input: preview, left: x, top: y });
    composites.push({ input: label, left: x, top: y + imageSize });
  }
  const sheetNumber = Math.floor(start / perSheet) + 1;
  const sheetPath = path.join(outputDir, `sheet-${String(sheetNumber).padStart(2, '0')}.webp`);
  await sharp({
    create: { width: columns * imageSize, height: rows * (imageSize + labelHeight), channels: 3, background: '#ddd' },
  }).composite(composites).webp({ quality: 88 }).toFile(sheetPath);
  index.push({ sheet: sheetPath, start: start + 1, end: start + batch.length });
}
await writeFile(path.join(outputDir, 'index.json'), `${JSON.stringify({ candidates, sheets: index }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, sheets: index.length, outputDir }, null, 2));
