#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin', 'prisma', 'dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const researchRoot = path.join(root, 'data', 'research', 'nature-expansion-photos-2026-09-13');
const payload = JSON.parse(await fs.readFile(path.join(researchRoot, 'approved-report.json'), 'utf8'));
const publicPrefix = '/uploads/nature-expansion-2026-09-13/';
const byPlace = new Map();

for (const record of payload.images) {
  if (!byPlace.has(record.placeId)) byPlace.set(record.placeId, []);
  byPlace.get(record.placeId).push(record);
}

const places = await prisma.place.findMany({
  where: { id: { in: [...byPlace.keys()] }, category: '自然' },
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } }
});
if (places.length !== byPlace.size) throw new Error(`Missing nature places: ${byPlace.size - places.length}`);

const operations = [];
for (const place of places) {
  const preserved = place.photos.filter((photo) => !photo.url.startsWith(publicPrefix));
  const incoming = byPlace.get(place.id).slice(0, Math.max(0, 10 - preserved.length));
  const desired = incoming.map((record, offset) => {
    const filename = path.basename(record.finalPath);
    const url = `${publicPrefix}${place.id}/${filename}`;
    return {
      sourcePath: path.resolve(root, record.finalPath),
      destinationPath: path.join(root, 'admin', 'public', url),
      id: `photo-${crypto.createHash('sha256').update(`${place.id}|${record.sourceUrl}`).digest('hex').slice(0, 24)}`,
      url,
      sortOrder: preserved.length + offset
    };
  });
  const current = place.photos.filter((photo) => photo.url.startsWith(publicPrefix))
    .map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  const comparable = desired.map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  if (JSON.stringify(current) !== JSON.stringify(comparable)) operations.push({ place, desired });
}

let backupPath = '';
if (apply && operations.length) {
  const backupRoot = path.join(root, 'data', 'backups', 'nature-expansion-2026-09-13');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-nature-expansion-photos-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backupPath);
  for (const { desired } of operations) {
    for (const photo of desired) {
      await fs.mkdir(path.dirname(photo.destinationPath), { recursive: true });
      await fs.copyFile(photo.sourcePath, photo.destinationPath);
    }
  }
  await prisma.$transaction(operations.flatMap(({ place, desired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id, url: { startsWith: publicPrefix } } }),
    prisma.place.update({
      where: { id: place.id },
      data: {
        pushedFingerprint: '',
        photos: { create: desired.map(({ id, url, sortOrder }) => ({ id, url, sortOrder })) }
      }
    })
  ]));
}

const selectedPhotos = operations.reduce((sum, operation) => sum + operation.desired.length, 0);
const result = {
  generatedAt: new Date().toISOString(), applied: apply, reviewedPhotos: payload.approvedCount,
  reviewedPlaces: byPlace.size, changedPlaces: operations.length, selectedPhotos, backupPath
};
await fs.writeFile(path.join(researchRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await prisma.$disconnect();
