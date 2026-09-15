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
const researchDir = path.join(root, 'data/research/suzhou-photo-refresh-2026-08-16');
const selection = JSON.parse(await fs.readFile(path.join(researchDir, 'selection.json'), 'utf8'));
const databasePath = path.join(root, 'admin/prisma/dev.db');
const uploadRoot = path.join(root, 'admin/public/uploads/suzhou-2026-08-16');
const backupRoot = path.join(root, 'data/backups/suzhou-photo-refresh-2026-08-16');

function hashPlaces(rows) {
  const stable = rows.map((place) => ({
    id: place.id, name: place.name, address: place.address, latitude: place.latitude,
    longitude: place.longitude, hours: place.hours, description: place.description,
    photos: place.photos.map((photo) => ({ url: photo.url, sortOrder: photo.sortOrder })),
  })).sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function isSuzhou(place) {
  return place.address.startsWith('苏州市') || place.address.startsWith('苏州高新区');
}

async function renderSquare(sourcePath, destination, cropMode) {
  const absoluteSource = path.resolve(root, sourcePath);
  const metadata = await sharp(absoluteSource).metadata();
  let pipeline = sharp(absoluteSource).rotate();
  if (cropMode === 'no-bottom' && metadata.width >= metadata.height) {
    const size = Math.min(metadata.width, Math.floor(metadata.height * 0.86));
    pipeline = pipeline.extract({ left: Math.floor((metadata.width - size) / 2), top: 0, width: size, height: size });
  }
  await pipeline.resize(960, 960, { fit: 'cover', position: 'centre' }).webp({ quality: 91 }).toFile(destination);
}

const before = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const shanghaiBefore = before.filter((place) => !isSuzhou(place));
const selectedIds = new Set(selection.places.map((place) => place.id));
const targets = before.filter((place) => selectedIds.has(place.id));
if (targets.length !== selection.places.length) throw new Error('部分苏州图片目标不存在');
for (const place of selection.places) {
  const current = targets.find((target) => target.id === place.id);
  if (current.name !== place.name) throw new Error(`点位名称不匹配：${place.name}`);
  if (!isSuzhou(current)) throw new Error(`目标不属于苏州：${place.name}`);
  if (place.images.length < 1 || place.images.length > 5) throw new Error(`图片数量越界：${place.name}`);
  for (const image of place.images) await fs.access(path.resolve(root, image.path));
}

let backupPath = '';
if (apply) {
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backupPath = path.join(backupRoot, `dev-before-photo-refresh-${stamp}.db`);
  await fs.copyFile(databasePath, backupPath);
  for (const place of selection.places) {
    const destinationDir = path.join(uploadRoot, place.id);
    const mediaBackupDir = path.join(backupRoot, `media-${stamp}`, place.id);
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.mkdir(mediaBackupDir, { recursive: true });
    const currentFiles = await fs.readdir(destinationDir);
    for (const filename of currentFiles) {
      if (/^\d+\.webp$/.test(filename)) {
        await fs.copyFile(path.join(destinationDir, filename), path.join(mediaBackupDir, filename));
      }
    }
    for (const [index, image] of place.images.entries()) {
      await renderSquare(image.path, path.join(destinationDir, `${String(index + 1).padStart(2, '0')}.webp`), image.crop);
    }
    for (const filename of currentFiles) {
      const match = filename.match(/^(\d+)\.webp$/);
      if (match && Number(match[1]) > place.images.length) await fs.rm(path.join(destinationDir, filename));
    }
    await prisma.$transaction(async (tx) => {
      await tx.placePhoto.deleteMany({ where: { placeId: place.id } });
      await tx.placePhoto.createMany({ data: place.images.map((image, index) => ({
        id: `sz20260816refresh_${place.id}_${index + 1}`,
        placeId: place.id,
        url: `/uploads/suzhou-2026-08-16/${place.id}/${String(index + 1).padStart(2, '0')}.webp`,
        sortOrder: index,
      })) });
      await tx.place.update({ where: { id: place.id }, data: { pushedFingerprint: '' } });
    });
  }
}

const after = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const shanghaiAfter = after.filter((place) => !isSuzhou(place));
const report = {
  mode: apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), backupPath,
  placeCount: selection.places.length,
  photoCount: selection.places.reduce((sum, place) => sum + place.images.length, 0),
  shanghaiHashBefore: hashPlaces(shanghaiBefore), shanghaiHashAfter: hashPlaces(shanghaiAfter),
  places: selection.places.map((place) => ({ id: place.id, name: place.name, count: place.images.length, sourceUrl: place.sourceUrl })),
};
if (report.shanghaiHashBefore !== report.shanghaiHashAfter) throw new Error('上海数据哈希发生变化');
await fs.writeFile(path.join(researchDir, apply ? 'apply-report.json' : 'dry-run-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
