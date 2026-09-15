#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchRoot = path.join(root, 'data', 'research', 'nature-xhs-photos-2026-09-12');
const manifestPath = path.join(researchRoot, 'qa-selected', 'manifest.json');
const outputRoot = path.join(root, 'admin', 'public', 'uploads', 'nature-xhs-2026-09-12');
const reportPath = path.join(researchRoot, 'curated-report.json');

// Manual review of every full-resolution candidate. Portraits, maps, collages,
// unrelated places, text-heavy frames and prominent-subject people are omitted.
const approvedIndexes = new Set([
  1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 24,
  35, 36, 39, 40, 41, 42, 43, 44, 45, 48, 51, 53, 55, 57, 58, 61, 64,
  65, 66, 67, 69, 73, 74, 75, 76, 78, 79, 80, 81, 82, 87, 88, 89, 90, 91,
  93, 94, 96, 99, 101, 102, 103, 104, 106, 109, 112, 117, 119,
  121, 122, 123, 124, 128, 133, 135, 136, 137, 138, 141, 142, 144, 147,
  148, 150, 151, 152, 153, 154, 161, 165, 170, 176, 179, 182, 183,
  186, 187, 188, 190, 194, 196, 197
]);

const payload = JSON.parse(await readFile(manifestPath, 'utf8'));
const candidates = payload.candidates.filter((candidate) => approvedIndexes.has(candidate.index));
if (candidates.length !== approvedIndexes.size) throw new Error('Curated index is missing from source manifest');

await rm(outputRoot, { recursive: true, force: true });
const placeCounts = new Map();
const records = [];
for (const candidate of candidates) {
  const metadata = await sharp(candidate.sourcePath).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Unreadable image: ${candidate.sourcePath}`);
  const borderX = Math.round(metadata.width * 0.075);
  const borderY = Math.round(metadata.height * 0.075);
  const width = metadata.width - borderX * 2;
  const height = metadata.height - borderY * 2;
  if (width < 640 || height < 640) throw new Error(`Cropped image too small: ${candidate.sourcePath}`);
  const ordinal = (placeCounts.get(candidate.placeId) || 0) + 1;
  placeCounts.set(candidate.placeId, ordinal);
  const placeDirectory = path.join(outputRoot, candidate.placeId);
  await mkdir(placeDirectory, { recursive: true });
  const filename = `${String(ordinal).padStart(2, '0')}.webp`;
  const finalPath = path.join(placeDirectory, filename);
  await sharp(candidate.sourcePath)
    .extract({ left: borderX, top: borderY, width, height })
    .resize(1024, 1024, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 88, effort: 5 })
    .toFile(finalPath);
  records.push({
    index: candidate.index,
    placeId: candidate.placeId,
    placeName: candidate.placeName,
    address: candidate.address,
    sourcePath: candidate.sourcePath,
    finalPath,
    publicUrl: `/uploads/nature-xhs-2026-09-12/${candidate.placeId}/${filename}`,
    sourceUrl: candidate.note.sourceUrl || `https://www.xiaohongshu.com/explore/${candidate.noteId}`,
    sourceTitle: candidate.note.title || '',
    contentHash: createHash('sha256').update(await readFile(finalPath)).digest('hex')
  });
}

await writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  review: 'Full-frame manual review, 7.5% edge trim, then final-crop manual review',
  photoCount: records.length,
  placeCount: placeCounts.size,
  records
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ photos: records.length, places: placeCounts.size, outputRoot }, null, 2)}\n`);
