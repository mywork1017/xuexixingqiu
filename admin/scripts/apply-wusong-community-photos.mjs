import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const placeId = 'nature-edb0d087ea68dab381f9a465';
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const outputDir = path.join(root, 'admin/public/uploads/nature-major-community-2026-09-13', placeId);
const reportDir = path.join(root, 'data/research/nature-major-community-2026-09-13');

const photos = [
  ['01.webp', 'https://dp.pconline.com.cn/dphoto/list_3214952.html', 'https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1311/25/c9/28991056_28991056_1385383645968.jpg', true],
  ['02.webp', 'https://dp.pconline.com.cn/dphoto/list_3214952.html', 'https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1311/25/c9/28991006_28991006_1385383559593.jpg', true],
  ['03.webp', 'https://you.ctrip.com/sight/shanghai2/47287.html', 'https://youimg1.c-ctrip.com/target/100e1f000001g8eawD9D5.jpg', false],
  ['04.webp', 'https://dp.pconline.com.cn/photo/2236087_2.html', 'https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1112/31/c2/10106850_10106850_1325296924250.jpg', false],
  ['05.webp', 'https://shanghaiimayou.blog.fc2.com/blog-entry-417.html', 'https://blog-imgs-146-origin.fc2.com/s/h/a/shanghaiimayou/20210206134634fa0.jpg', false]
].map(([file, sourcePage, sourceUrl, croppedToRemoveMark], index) => ({
  id: `photo-community-wusong-${String(index + 1).padStart(2, '0')}`,
  file,
  sourcePage,
  sourceUrl,
  croppedToRemoveMark,
  sortOrder: index,
  publicUrl: `/uploads/nature-major-community-2026-09-13/${placeId}/${file}`
}));

const place = await prisma.place.findUnique({ where: { id: placeId }, include: { photos: true } });
if (!place) throw new Error(`Missing place ${placeId}`);
let backupPath = '';
if (apply) {
  backupPath = path.join(root, 'data/backups/nature-major-community-2026-09-13', `dev-before-wusong-photos-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  for (const photo of photos) {
    await copyFile(path.join(root, 'tmp/wusong-final-processed', photo.file), path.join(outputDir, photo.file));
  }
  await prisma.$transaction([
    prisma.placePhoto.deleteMany({ where: { placeId } }),
    ...photos.map((photo) => prisma.placePhoto.create({ data: { id: photo.id, placeId, url: photo.publicUrl, sortOrder: photo.sortOrder } })),
    prisma.place.update({ where: { id: placeId }, data: { pushedFingerprint: '' } })
  ]);
}
await prisma.$disconnect();

const report = { generatedAt: new Date().toISOString(), applied: apply, placeId, placeName: place.name, previousPhotos: place.photos.length, finalPhotos: photos.length, backupPath, records: photos };
await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, place: place.name, previousPhotos: place.photos.length, finalPhotos: photos.length, backupPath }, null, 2));
