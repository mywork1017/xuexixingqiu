import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-jingan-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['慧芝湖社区长者食堂', '上海市静安区平型关路1115号', 31.282378, 121.457849],
  ['阳曲路社区长者食堂', '上海市静安区阳曲路391弄16号', 31.312036, 121.458912],
  ['新旺美食林酒家社区长者食堂', '上海市静安区岭南路722号', 31.317697, 121.456088],
  ['永和路社区长者食堂', '上海市静安区永和路616号', 31.287146, 121.434879],
  ['小镇舒食社区长者食堂', '上海市静安区高平路141号1层', 31.279379, 121.430178]
].map(([name, address, latitude, longitude]) => ({ name, category: '食堂', address, latitude, longitude, hours: '', description: '', pushedFingerprint: '' }));

const existing = await prisma.place.findMany({ where: { category: '食堂' }, select: { name: true, address: true } });
const planned = places.filter((place) => !existing.some((item) => item.name === place.name || item.address === place.address));
const duplicates = places.filter((place) => !planned.includes(place));
let backupPath = '';
let created = [];
if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-jingan-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-jingan-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } })));
}
await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '静安区人民政府：17家静邻餐厅春节开放名单（2025-01-27）',
  sourceUrl: 'https://www.shanghai.gov.cn/nw17239/20250127/5b02c5f2d4884d1e87668f527c2896b9.html',
  mapVerification: 'Apple 地图中国区（高德底图）门牌或同址服务中心 POI',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
