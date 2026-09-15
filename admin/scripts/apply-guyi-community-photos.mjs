import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const placeId = 'nature-1809ca5c292a3480f3ffbfd3';
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const outputDir = path.join(root, 'admin/public/uploads/nature-major-community-2026-09-13', placeId);
const reportDir = path.join(root, 'data/research/nature-major-community-2026-09-13');
const sources = [
  ['existing-reviewed', '/uploads/nature-official-final-2026-09-12/f7a5b2d127264c1514a0cf22.webp', false],
  ['https://img.lubanyuan.com.cn/d/file/p/jiagong/zhucai/2023/05-09/1683562661_587.jpg', 'https://img.lubanyuan.com.cn/d/file/p/jiagong/zhucai/2023/05-09/1683562661_587.jpg', false],
  ['https://you.ctrip.com/sight/shanghai2.html', 'https://dimg04.c-ctrip.com/images/0105l12000a1ryeb6F1AA_W_640_10000.jpg?proc=autoorient', true],
  ['https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1103/26/c8/7118313_7118313_1301140606484.jpg', 'https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1103/26/c8/7118313_7118313_1301140606484.jpg', false],
  ['https://you.ctrip.com/sight/shanghai2.html', 'https://dimg04.c-ctrip.com/images/1me2n12000rd6gi7yCF12.jpg?proc=source%2Ftripcommunity', true]
];

const place = await prisma.place.findUnique({ where: { id: placeId }, include: { photos: true } });
if (!place) throw new Error(`Missing place ${placeId}`);
let backupPath = '';
if (apply) {
  backupPath = path.join(root, 'data/backups/nature-major-community-2026-09-13', `dev-before-guyi-photos-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  for (let index = 0; index < sources.length; index += 1) {
    const file = `${String(index + 1).padStart(2, '0')}.webp`;
    await copyFile(path.join(root, 'tmp/guyi-final-processed', file), path.join(outputDir, file));
  }
  await prisma.$transaction([
    prisma.placePhoto.deleteMany({ where: { placeId } }),
    ...sources.map((_, index) => {
      const file = `${String(index + 1).padStart(2, '0')}.webp`;
      return prisma.placePhoto.create({ data: { id: `photo-community-guyi-${file.slice(0, 2)}`, placeId, url: `/uploads/nature-major-community-2026-09-13/${placeId}/${file}`, sortOrder: index } });
    }),
    prisma.place.update({ where: { id: placeId }, data: { pushedFingerprint: '' } })
  ]);
}
await prisma.$disconnect();
const records = sources.map(([sourcePage, sourceUrl, croppedToRemoveText], index) => ({
  file: `${String(index + 1).padStart(2, '0')}.webp`, sourcePage, sourceUrl, croppedToRemoveText,
  manuallyReviewedOriginal: true, manuallyReviewedFinal: true
}));
const report = { generatedAt: new Date().toISOString(), applied: apply, placeId, placeName: place.name, previousPhotos: place.photos.length, finalPhotos: records.length, backupPath, records };
await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, apply ? 'guyi-apply-report.json' : 'guyi-preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, place: place.name, previousPhotos: place.photos.length, finalPhotos: records.length, backupPath }, null, 2));
