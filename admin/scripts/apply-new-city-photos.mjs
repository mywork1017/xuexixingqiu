import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin/prisma/dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const researchDir = path.join(root, 'data/research/new-city-photo-crawl-2026-08-16');
const selection = JSON.parse(await fs.readFile(path.join(researchDir, 'selection.json'), 'utf8'));
const databasePath = path.join(root, 'admin/prisma/dev.db');
const uploadRoot = path.join(root, 'admin/public/uploads/new-cities-2026-08-16');
const backupRoot = path.join(root, 'data/backups/new-city-photos-2026-08-16');
const cityPrefixes = ['嘉兴市', '南通市', '无锡市', '镇江市'];

function hashPlaces(rows) {
  const stable = rows.map((place) => ({
    id: place.id, name: place.name, address: place.address, latitude: place.latitude,
    longitude: place.longitude, hours: place.hours, description: place.description,
    photos: place.photos.map((photo) => ({ url: photo.url, sortOrder: photo.sortOrder })),
  })).sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function isTargetCity(place) {
  return cityPrefixes.some((prefix) => place.address.startsWith(prefix));
}

async function renderSquare(sourcePath, destination, crop) {
  await sharp(path.resolve(root, sourcePath)).rotate()
    .resize(960, 960, { fit: 'cover', position: crop === 'north' ? 'north' : 'centre' })
    .webp({ quality: 91 })
    .toFile(destination);
}

const before = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const untouchedBefore = before.filter((place) => !isTargetCity(place));
const selectedIds = new Set(selection.places.map((place) => place.id));
const targets = before.filter((place) => selectedIds.has(place.id));
if (targets.length !== selection.places.length) throw new Error('部分四城图片目标不存在');
for (const place of selection.places) {
  const current = targets.find((target) => target.id === place.id);
  if (current.name !== place.name || !isTargetCity(current)) throw new Error(`点位不匹配：${place.name}`);
  for (const image of place.images) await fs.access(path.resolve(root, image.path));
}

let backupPath = '';
if (apply) {
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backupPath = path.join(backupRoot, `dev-before-new-city-photos-${stamp}.db`);
  await fs.copyFile(databasePath, backupPath);
  for (const place of selection.places) {
    const destinationDir = path.join(uploadRoot, place.id);
    await fs.mkdir(destinationDir, { recursive: true });
    for (const [index, image] of place.images.entries()) {
      await renderSquare(image.path, path.join(destinationDir, `${String(index + 1).padStart(2, '0')}.webp`), image.crop);
    }
    await prisma.$transaction(async (tx) => {
      await tx.placePhoto.deleteMany({ where: { placeId: place.id } });
      await tx.placePhoto.createMany({ data: place.images.map((image, index) => ({
        id: `cities20260816_${place.id}_${index + 1}`,
        placeId: place.id,
        url: `/uploads/new-cities-2026-08-16/${place.id}/${String(index + 1).padStart(2, '0')}.webp`,
        sortOrder: index,
      })) });
      await tx.place.update({ where: { id: place.id }, data: { pushedFingerprint: '' } });
    });
  }
}

const after = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const report = {
  mode: apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), backupPath,
  placeCount: selection.places.length,
  photoCount: selection.places.reduce((sum, place) => sum + place.images.length, 0),
  untouchedHashBefore: hashPlaces(untouchedBefore),
  untouchedHashAfter: hashPlaces(after.filter((place) => !isTargetCity(place))),
  places: selection.places.map((place) => ({ id: place.id, name: place.name, sourceUrl: place.sourceUrl })),
};
if (report.untouchedHashBefore !== report.untouchedHashAfter) throw new Error('非目标城市数据哈希变化');
await fs.writeFile(path.join(researchDir, apply ? 'photo-apply-report.json' : 'photo-dry-run-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
