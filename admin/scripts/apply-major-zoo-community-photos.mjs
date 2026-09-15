import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const uploadRoot = path.join(root, 'admin/public/uploads/nature-major-community-2026-09-13');
const preparedRoot = path.join(root, 'tmp/zoo-final-processed');
const reportDir = path.join(root, 'data/research/nature-major-community-2026-09-13');

const groups = [
  {
    placeId: 'nature-1af8beebfd1c82b6af9eaf92',
    sourceFolder: 'shanghai-zoo',
    photos: [
      ['https://bbs.zol.com.cn/dcbbs/d33995_24931.html', 'https://newbbs-fd.zol-img.com.cn/t_s1200x5000/g7/M00/0F/08/ChMkLGSZl-6IAfjBAAqk_REjc9YAAR85AO0xTAACqUV940.jpg'],
      ['https://travel.qunar.com/p-oi704220-shanghaidongwuyuan', 'https://youimg1.c-ctrip.com/target/100f13000000tldr58B0D.jpg'],
      ['https://travel.qunar.com/p-oi704220-shanghaidongwuyuan', 'https://youimg1.c-ctrip.com/target/100h1600000102ppu869B.jpg'],
      ['https://travel.qunar.com/p-oi704220-shanghaidongwuyuan', 'https://youimg1.c-ctrip.com/target/100j13000000tkvkeBB64.jpg'],
      ['https://travel.qunar.com/p-oi704220-shanghaidongwuyuan', 'https://youimg1.c-ctrip.com/target/100i13000000tk6ihE417.jpg']
    ]
  },
  {
    placeId: 'nature-ee30439b8b5f3ddee24d7a56',
    sourceFolder: 'wild-animal-park',
    photos: [
      ['https://tw.trip.com/things-to-do/detail/96471129/', 'https://ak-d.tripcdn.com/images/0353e12000n9ous8n8337.jpg'],
      ['https://kr.trip.com/guide/attraction/shanghai-wildlife-park.html', 'https://dimg04.tripcdn.com/images/0M73512000rb699k3154D_Q50.jpg'],
      ['https://gs.ctrip.com/html5/you/sight/shanghai2/4670109.html', 'https://dimg04.c-ctrip.com/images/1me0e12000s3fnskl979A.jpg?proc=source%2Ftripcommunity'],
      ['https://www.trip.com/guide/attraction/shanghai-wild-animal-park.html', 'https://ak-d.tripcdn.com/images/0EQ1f424x98uu769x5AE7.jpg?proc=source%2Ftrip'],
      ['https://www.trip.com/guide/attraction/shanghai-wild-animal-park.html', 'https://ak-d.tripcdn.com/images/0EQ1w224x99hc1mpwF291.jpg?proc=source%2Ftrip']
    ]
  }
];

const places = [];
for (const group of groups) {
  const place = await prisma.place.findUnique({ where: { id: group.placeId }, include: { photos: true } });
  if (!place) throw new Error(`Missing place ${group.placeId}`);
  places.push({ group, place });
}

let backupPath = '';
if (apply) {
  backupPath = path.join(root, 'data/backups/nature-major-community-2026-09-13', `dev-before-zoo-photos-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await mkdir(reportDir, { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  for (const { group } of places) {
    const outputDir = path.join(uploadRoot, group.placeId);
    await mkdir(outputDir, { recursive: true });
    for (let index = 0; index < group.photos.length; index += 1) {
      const file = `${String(index + 1).padStart(2, '0')}.webp`;
      await copyFile(path.join(preparedRoot, group.sourceFolder, file), path.join(outputDir, file));
    }
  }
  await prisma.$transaction(places.flatMap(({ group }) => [
    prisma.placePhoto.deleteMany({ where: { placeId: group.placeId } }),
    ...group.photos.map((_, index) => {
      const file = `${String(index + 1).padStart(2, '0')}.webp`;
      return prisma.placePhoto.create({ data: {
        id: `photo-community-zoo-${group.placeId.slice(-8)}-${String(index + 1).padStart(2, '0')}`,
        placeId: group.placeId,
        url: `/uploads/nature-major-community-2026-09-13/${group.placeId}/${file}`,
        sortOrder: index
      } });
    }),
    prisma.place.update({ where: { id: group.placeId }, data: { pushedFingerprint: '' } })
  ]));
}
await prisma.$disconnect();

const records = places.map(({ group, place }) => ({
  placeId: group.placeId,
  placeName: place.name,
  previousPhotos: place.photos.length,
  finalPhotos: group.photos.length,
  photos: group.photos.map(([sourcePage, sourceUrl], index) => ({
    file: `${String(index + 1).padStart(2, '0')}.webp`, sourcePage, sourceUrl,
    publicUrl: `/uploads/nature-major-community-2026-09-13/${group.placeId}/${String(index + 1).padStart(2, '0')}.webp`,
    manuallyReviewedOriginal: true, manuallyReviewedFinal: true
  }))
}));
const report = { generatedAt: new Date().toISOString(), applied: apply, backupPath, records };
await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, apply ? 'zoo-apply-report.json' : 'zoo-preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, backupPath, records: records.map(({ placeName, previousPhotos, finalPhotos }) => ({ placeName, previousPhotos, finalPhotos })) }, null, 2));
