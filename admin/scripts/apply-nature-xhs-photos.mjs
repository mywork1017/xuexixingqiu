#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin', 'prisma', 'dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const reportPath = path.join(root, 'data', 'research', 'nature-xhs-photos-2026-09-12', 'curated-report.json');
const payload = JSON.parse(await fs.readFile(reportPath, 'utf8'));
const byPlace = new Map();
for (const photo of payload.records) {
  if (!byPlace.has(photo.placeId)) byPlace.set(photo.placeId, []);
  byPlace.get(photo.placeId).push(photo);
}
const placeIds = [...byPlace.keys()];
const places = await prisma.place.findMany({ where: { id: { in: placeIds }, category: '自然' }, include: { photos: true } });
if (places.length !== placeIds.length) throw new Error(`Missing nature places: expected ${placeIds.length}, found ${places.length}`);
const operations = [];
for (const place of places) {
  const preserved = place.photos.filter((photo) => !photo.url.startsWith('/uploads/nature-xhs-2026-09-12/'));
  const incoming = byPlace.get(place.id);
  const desired = incoming.map((photo, offset) => ({
    id: `photo-${crypto.createHash('sha256').update(`${place.id}|${photo.publicUrl}`).digest('hex').slice(0, 24)}`,
    url: photo.publicUrl,
    sortOrder: preserved.length + offset
  }));
  const current = place.photos.filter((photo) => photo.url.startsWith('/uploads/nature-xhs-2026-09-12/'))
    .map(({ id, url, sortOrder }) => ({ id, url, sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder);
  if (JSON.stringify(current) !== JSON.stringify(desired)) operations.push({ place, desired });
}
let backupPath = '';
if (apply && operations.length) {
  const backupRoot = path.join(root, 'data', 'backups', 'nature-places-2026-09-12');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-nature-xhs-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(operations.flatMap(({ place, desired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id, url: { startsWith: '/uploads/nature-xhs-2026-09-12/' } } }),
    prisma.place.update({ where: { id: place.id }, data: { pushedFingerprint: '', photos: { create: desired } } })
  ]));
}
const result = { applied: apply, places: placeIds.length, photos: payload.records.length, changedPlaces: operations.length, backupPath };
await fs.writeFile(path.join(root, 'data', 'research', 'nature-xhs-photos-2026-09-12', apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await prisma.$disconnect();
