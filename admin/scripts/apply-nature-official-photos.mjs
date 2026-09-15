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
const payload = JSON.parse(await fs.readFile(path.join(root, 'data', 'research', 'nature-places-2026-09-12', 'photo-official-curated-report.json'), 'utf8'));
const desiredByPlace = new Map(payload.records.map((record) => [record.placeId, record]));
const places = await prisma.place.findMany({ where: { category: '自然', address: { startsWith: '上海市' } }, include: { photos: true } });
const officialPrefixes = ['/uploads/nature-2026-09-12/', '/uploads/nature-official-final-2026-09-12/'];
const operations = [];
for (const place of places) {
  const preserved = place.photos.filter((photo) => !officialPrefixes.some((prefix) => photo.url.startsWith(prefix)));
  const record = desiredByPlace.get(place.id);
  const desired = record ? [{
    id: `photo-${crypto.createHash('sha256').update(`${place.id}|${record.publicUrl}`).digest('hex').slice(0, 24)}`,
    url: record.publicUrl,
    sortOrder: 0
  }] : [];
  const preservedDesired = preserved
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((photo, index) => ({ id: photo.id, sortOrder: desired.length + index }));
  const current = place.photos.filter((photo) => officialPrefixes.some((prefix) => photo.url.startsWith(prefix)))
    .map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  const preservedChanged = preservedDesired.some((photo) => preserved.find((currentPhoto) => currentPhoto.id === photo.id)?.sortOrder !== photo.sortOrder);
  if (JSON.stringify(current) !== JSON.stringify(desired) || preservedChanged) operations.push({ place, desired, preservedDesired });
}
let backupPath = '';
if (apply && operations.length) {
  const backupRoot = path.join(root, 'data', 'backups', 'nature-places-2026-09-12');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-nature-official-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(operations.flatMap(({ place, desired, preservedDesired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id, OR: officialPrefixes.map((prefix) => ({ url: { startsWith: prefix } })) } }),
    ...preservedDesired.map((photo) => prisma.placePhoto.update({ where: { id: photo.id }, data: { sortOrder: photo.sortOrder } })),
    prisma.place.update({ where: { id: place.id }, data: { pushedFingerprint: '', photos: { create: desired } } })
  ]));
}
const result = { applied: apply, approvedPhotos: payload.records.length, changedPlaces: operations.length, backupPath };
await fs.writeFile(path.join(root, 'data', 'research', 'nature-places-2026-09-12', apply ? 'photo-official-apply-report.json' : 'photo-official-preview-report.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await prisma.$disconnect();
