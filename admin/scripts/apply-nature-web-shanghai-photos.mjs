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
const researchRoot = path.join(root, 'data', 'research', 'nature-web-photos-shanghai-2026-09-12');
const payload = JSON.parse(await fs.readFile(path.join(researchRoot, 'curated-report.json'), 'utf8'));
const byPlace = new Map();
for (const record of payload.records) {
  if (!byPlace.has(record.placeId)) byPlace.set(record.placeId, []);
  byPlace.get(record.placeId).push(record);
}
const places = await prisma.place.findMany({ where: { id: { in: [...byPlace.keys()] }, category: '自然' }, include: { photos: true } });
if (places.length !== byPlace.size) throw new Error(`Missing nature places: ${byPlace.size - places.length}`);
const prefix = '/uploads/nature-web-shanghai-final-2026-09-12/';
const operations = [];
for (const place of places) {
  const preserved = place.photos.filter((photo) => !photo.url.startsWith(prefix))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const desired = byPlace.get(place.id).map((record, index) => ({
    id: `photo-${crypto.createHash('sha256').update(`${place.id}|${record.publicUrl}`).digest('hex').slice(0, 24)}`,
    url: record.publicUrl,
    sortOrder: preserved.length + index
  }));
  const current = place.photos.filter((photo) => photo.url.startsWith(prefix))
    .map(({ id, url, sortOrder }) => ({ id, url, sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder);
  if (JSON.stringify(current) !== JSON.stringify(desired)) operations.push({ place, desired });
}
let backupPath = '';
if (apply && operations.length) {
  const backupRoot = path.join(root, 'data', 'backups', 'nature-places-2026-09-12');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-nature-web-shanghai-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(operations.flatMap(({ place, desired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id, url: { startsWith: prefix } } }),
    prisma.place.update({ where: { id: place.id }, data: { pushedFingerprint: '', photos: { create: desired } } })
  ]));
}
const result = { applied: apply, photos: payload.records.length, places: byPlace.size, changedPlaces: operations.length, backupPath };
await fs.writeFile(path.join(researchRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await prisma.$disconnect();
