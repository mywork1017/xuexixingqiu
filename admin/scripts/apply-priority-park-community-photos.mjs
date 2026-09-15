#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin', 'prisma', 'dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const sharp = (await import('sharp')).default;
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const researchRoot = path.join(root, 'data/research/priority-park-photo-crawl-2026-09-13');
const manifest = JSON.parse(await fs.readFile(path.join(researchRoot, 'qa/manifest.json'), 'utf8'));
const publicPrefix = '/uploads/nature-priority-community-2026-09-13/';
const outputRoot = path.join(root, 'admin/public', publicPrefix);

// All entries were reviewed individually at full size. Edge crops remove visible
// platform/date marks from otherwise usable scene photos.
const approvedIndexes = [
  2, 3, 4, 5, 6,
  8, 10, 11, 13, 14,
  17, 18, 19, 20, 21, 25,
  26, 27, 28, 30, 31, 32,
  33, 35, 36, 38, 39, 40, 41,
  43, 44, 46, 47, 48,
  51, 52, 53, 55, 58,
  60, 61, 62, 63, 64, 65, 67,
  69, 70, 72, 73, 74,
  75, 76, 77, 79, 81, 82, 83,
  84, 86, 87, 88, 90, 91, 92, 93,
  94, 95, 97, 98, 100,
  103, 105, 106, 107, 109, 110
];
const croppedIndexes = new Set([18, 21, 69]);
const selected = approvedIndexes.map((index) => {
  const record = manifest.find((item) => item.index === index);
  if (!record) throw new Error(`Missing manifest index ${index}`);
  return record;
});
const byPlace = new Map();
for (const record of selected) {
  if (!byPlace.has(record.placeId)) byPlace.set(record.placeId, []);
  byPlace.get(record.placeId).push(record);
}

const prepared = [];
for (const [placeId, records] of byPlace) {
  const destinationDir = path.join(outputRoot, placeId);
  await fs.mkdir(destinationDir, { recursive: true });
  for (const [offset, record] of records.entries()) {
    const filename = `${String(offset + 1).padStart(2, '0')}.webp`;
    const sourcePath = path.join(root, record.url);
    const destinationPath = path.join(destinationDir, filename);
    if (croppedIndexes.has(record.index)) {
      const metadata = await sharp(sourcePath).metadata();
      const trimX = Math.round(metadata.width * 0.07);
      const trimY = Math.round(metadata.height * 0.07);
      await sharp(sourcePath)
        .extract({ left: trimX, top: trimY, width: metadata.width - trimX * 2, height: metadata.height - trimY * 2 })
        .resize(1024, 1024, { fit: 'cover' })
        .webp({ quality: 86 })
        .toFile(destinationPath);
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
    prepared.push({
      placeId,
      placeName: record.placeName,
      reviewedIndex: record.index,
      sourcePage: record.sourcePage,
      sourceUrl: record.sourceUrl,
      sourceChannel: record.channel,
      sourceTitle: record.title,
      originalWidth: record.width,
      originalHeight: record.height,
      croppedToRemoveMark: croppedIndexes.has(record.index),
      finalPath: path.relative(root, destinationPath),
      publicUrl: `${publicPrefix}${placeId}/${filename}`
    });
  }
}

const places = await prisma.place.findMany({
  where: { id: { in: [...byPlace.keys()] }, category: '自然' },
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } }
});
if (places.length !== byPlace.size) throw new Error(`Missing priority places: ${byPlace.size - places.length}`);

const operations = places.map((place) => {
  const records = prepared.filter((record) => record.placeId === place.id);
  const desired = records.map((record, sortOrder) => ({
    id: `photo-${crypto.createHash('sha256').update(`${place.id}|${record.sourceUrl}`).digest('hex').slice(0, 24)}`,
    url: record.publicUrl,
    sortOrder
  }));
  const current = place.photos.map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  return { place, desired, changed: JSON.stringify(current) !== JSON.stringify(desired) };
}).filter((operation) => operation.changed);

let backupPath = '';
if (apply && operations.length) {
  const backupRoot = path.join(root, 'data/backups/nature-priority-community-2026-09-13');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-priority-community-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  await prisma.$transaction(operations.flatMap(({ place, desired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id } }),
    prisma.place.update({
      where: { id: place.id },
      data: { pushedFingerprint: '', photos: { create: desired } }
    })
  ]));
}

const report = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  reviewedPhotos: prepared.length,
  reviewedPlaces: byPlace.size,
  changedPlaces: operations.length,
  backupPath,
  records: prepared
};
await fs.writeFile(path.join(researchRoot, apply ? 'curated-apply-report.json' : 'curated-preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, records: undefined }, null, 2)}\n`);
await prisma.$disconnect();
