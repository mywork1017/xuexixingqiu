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
const prefix = '/uploads/crawl4ai-scaleup-2026-09-14/';
const manifests = [
  'data/research/crawl4ai-photo-scaleup-2026-09-13/shanghai/review-v4-manifest.json',
  'data/research/crawl4ai-photo-scaleup-2026-09-13/suzhou/review-v3-manifest.json'
];
const images = [];
for (const file of manifests) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
  images.push(...manifest.images);
}
const byPlace = new Map();
for (const image of images) {
  if (!byPlace.has(image.placeId)) byPlace.set(image.placeId, []);
  byPlace.get(image.placeId).push(image);
}
const places = await prisma.place.findMany({
  where: { id: { in: [...byPlace.keys()] }, category: '自然' },
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } }
});
if (places.length !== byPlace.size) throw new Error(`Missing places: ${byPlace.size - places.length}`);
const changes = [];
for (const place of places) {
  const preserved = place.photos.filter((photo) => !photo.url.startsWith(prefix));
  const seen = new Set();
  const desiredLimit = Math.max(0, 10 - preserved.length);
  const desired = byPlace.get(place.id).filter((image) => {
    if (!image.sourceUrl || seen.has(image.sourceUrl)) return false;
    seen.add(image.sourceUrl);
    return true;
  }).slice(0, desiredLimit).map((image, index) => {
    const hash = crypto.createHash('sha256').update(`${prefix}|${place.id}|${image.sourceUrl}`).digest('hex').slice(0, 24);
    const url = `${prefix}${place.id}/${hash}.webp`;
    return {
      id: `photo-${hash}`,
      url,
      sortOrder: preserved.length + index,
      source: path.join(root, image.url),
      target: path.join(root, 'admin', 'public', url)
    };
  });
  const current = place.photos.filter((photo) => photo.url.startsWith(prefix))
    .map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  const next = desired.map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  if (JSON.stringify(current) !== JSON.stringify(next)) changes.push({ place, desired });
}

let backup = '';
let orphanFilesRemoved = 0;
if (apply && changes.length) {
  const backupDir = path.join(root, 'data', 'backups', 'crawl4ai-scaleup-2026-09-14');
  await fs.mkdir(backupDir, { recursive: true });
  backup = path.join(backupDir, `dev-before-crawl4ai-scaleup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backup);
  for (const change of changes) {
    for (const photo of change.desired) {
      await fs.mkdir(path.dirname(photo.target), { recursive: true });
      await fs.copyFile(photo.source, photo.target);
    }
  }
  await prisma.$transaction(changes.flatMap(({ place, desired }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: place.id, url: { startsWith: prefix } } }),
    prisma.place.update({
      where: { id: place.id },
      data: {
        pushedFingerprint: '',
        photos: { create: desired.map(({ id, url, sortOrder }) => ({ id, url, sortOrder })) }
      }
    })
  ]));
}
if (apply) {
  const publicRoot = path.join(root, 'admin', 'public');
  const assetRoot = path.join(publicRoot, prefix);
  const referenced = new Set((await prisma.placePhoto.findMany({
    where: { url: { startsWith: prefix } },
    select: { url: true }
  })).map(({ url }) => url));
  const pendingDirs = [assetRoot];
  while (pendingDirs.length) {
    const directory = pendingDirs.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pendingDirs.push(file);
      if (!entry.isFile() || path.extname(entry.name) !== '.webp') continue;
      const url = `/${path.relative(publicRoot, file).split(path.sep).join('/')}`;
      if (!referenced.has(url)) {
        await fs.unlink(file);
        orphanFilesRemoved += 1;
      }
    }
  }
}
const result = {
  applied: apply,
  candidatePhotos: images.length,
  places: byPlace.size,
  changedPlaces: changes.length,
  writtenPhotos: changes.reduce((sum, change) => sum + change.desired.length, 0),
  orphanFilesRemoved,
  backup
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await prisma.$disconnect();
