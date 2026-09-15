#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');
const sourceRoot = path.resolve(process.argv[2] || 'data/research/nature-xhs-photos-2026-09-12');
const outputRoot = path.resolve(process.argv[3] || 'data/research/nature-xhs-photos-2026-09-12/qa-selected');
const maxPerPlace = Number(process.env.MAX_PER_PLACE || 10);
const columns = 3;
const rows = 3;
const imageSize = 400;
const labelHeight = 64;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function dhash(imagePath) {
  const { data } = await sharp(imagePath).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      hash = (hash << 1n) | BigInt(data[row * 9 + column] > data[row * 9 + column + 1]);
    }
  }
  return hash;
}

function hamming(left, right) {
  let value = left ^ right;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

const roots = [];
for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'qa-selected') continue;
  const directory = path.join(sourceRoot, entry.name);
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    roots.push({ directory, manifest });
  } catch {}
}

const selected = [];
for (const { directory, manifest } of roots) {
  for (const placeRecord of manifest.places || []) {
    const noteById = new Map((placeRecord.notes || []).map((note) => [note.id, note]));
    const candidates = (placeRecord.images || [])
      .filter((image) => !image.rejected)
      .map((image) => ({
        ...image,
        placeId: placeRecord.place.id,
        placeName: placeRecord.place.name,
        address: placeRecord.place.address,
        query: placeRecord.query,
        note: noteById.get(image.noteId) || {},
        sourcePath: path.join(directory, placeRecord.place.id, image.filename)
      }));
    const byNote = new Map();
    for (const candidate of candidates) {
      if (!byNote.has(candidate.noteId)) byNote.set(candidate.noteId, []);
      byNote.get(candidate.noteId).push(candidate);
    }
    for (const images of byNote.values()) {
      images.sort((left, right) => {
        const leftRank = left.imageIndex === 0 ? 20 : left.imageIndex;
        const rightRank = right.imageIndex === 0 ? 20 : right.imageIndex;
        return leftRank - rightRank;
      });
    }
    const interleaved = [];
    while ([...byNote.values()].some((images) => images.length)) {
      for (const images of byNote.values()) if (images.length) interleaved.push(images.shift());
    }
    const chosen = [];
    const hashes = [];
    for (const candidate of interleaved) {
      if (chosen.length >= maxPerPlace) break;
      const hash = await dhash(candidate.sourcePath);
      if (hashes.some((existing) => hamming(existing, hash) <= 7)) continue;
      hashes.push(hash);
      chosen.push(candidate);
    }
    selected.push(...chosen);
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const indexed = [];
for (let start = 0; start < selected.length; start += perSheet) {
  const batch = selected.slice(start, start + perSheet);
  const composites = [];
  for (const [cell, candidate] of batch.entries()) {
    const left = (cell % columns) * imageSize;
    const top = Math.floor(cell / columns) * (imageSize + labelHeight);
    const preview = await sharp(candidate.sourcePath)
      .resize(imageSize, imageSize, { fit: 'contain', background: '#1b1b1b' })
      .jpeg({ quality: 92 })
      .toBuffer();
    const label = Buffer.from(`<svg width="${imageSize}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#111"/>
      <text x="8" y="22" font-size="14" font-family="PingFang SC,Arial" fill="#fff">${escapeXml(`${start + cell + 1}. ${candidate.placeName}`)}</text>
      <text x="8" y="45" font-size="11" font-family="PingFang SC,Arial" fill="#bbb">${escapeXml((candidate.note.title || '').slice(0, 46))}</text>
    </svg>`);
    composites.push({ input: preview, left, top });
    composites.push({ input: label, left, top: top + imageSize });
    indexed.push({ index: start + cell + 1, sheet: Math.floor(start / perSheet) + 1, ...candidate });
  }
  await sharp({
    create: { width: columns * imageSize, height: rows * (imageSize + labelHeight), channels: 3, background: '#ddd' }
  }).composite(composites).jpeg({ quality: 94 }).toFile(
    path.join(outputRoot, `sheet-${String(Math.floor(start / perSheet) + 1).padStart(2, '0')}.jpg`)
  );
}
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'xhs-cli 正文图片候选；首图后置；跨帖子轮选；感知哈希去重',
  maxPerPlace,
  candidates: indexed
}, null, 2)}\n`);
console.log(JSON.stringify({ places: new Set(indexed.map((item) => item.placeId)).size, candidates: indexed.length, sheets: Math.ceil(indexed.length / perSheet), outputRoot }, null, 2));
