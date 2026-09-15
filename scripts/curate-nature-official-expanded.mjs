#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const { PrismaClient } = require('@prisma/client');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin', 'prisma', 'dev.db')}`;
const prisma = new PrismaClient();
const researchRoot = path.join(root, 'data', 'research', 'nature-places-2026-09-12');
const source = JSON.parse(await readFile(path.join(researchRoot, 'photo-preparation-expanded-report.json'), 'utf8'));
const outputRoot = path.join(root, 'admin', 'public', 'uploads', 'nature-official-final-2026-09-12');

// Decisions from full-frame and final-crop manual review.
const rejectedNames = new Set([
  '春眺园', '新虹法治文化主题公园', '西部绿苑', '银翔湖公园', '诸翟公园', '泖港公园',
  '南水关公园', '平阳双拥公园', '滨海公园', '丹巴公园', '合庆公园', '长青公园',
  '张堰公园', '大宁公园', '交通公园', '闸北公园', '上南公园', '桂湖园', '安亭公园',
  '广场公园', '彩虹湾公园', '奉城公园', '锦溪园', '国伟路公共绿地', '曼趣公园',
  '桃浦公园', '上海滨江森林公园'
]);

const places = await prisma.place.findMany({ where: { category: '自然', address: { startsWith: '上海市' } } });
const placeByName = new Map(places.map((place) => [place.name, place]));
const records = source.records.filter((record) => record.status === 'prepared' && placeByName.has(record.name) && !rejectedNames.has(record.name));
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const record of records) {
  const filename = path.basename(record.finalPath);
  const destination = path.join(outputRoot, filename);
  await copyFile(record.finalPath, destination);
  record.placeId = placeByName.get(record.name).id;
  record.finalPath = destination;
  record.publicUrl = `/uploads/nature-official-final-2026-09-12/${filename}`;
}
const report = {
  generatedAt: new Date().toISOString(),
  sourcePrepared: source.prepared,
  approved: records.length,
  rejected: [...rejectedNames].sort(),
  records
};
await writeFile(path.join(researchRoot, 'photo-official-curated-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ approved: records.length, rejected: rejectedNames.size, outputRoot }, null, 2)}\n`);
await prisma.$disconnect();
