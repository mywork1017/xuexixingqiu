import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-putuo-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['胶州片区社区长者食堂', '上海市普陀区长寿路505弄6号一楼', 31.237455, 121.435525],
  ['万里街道社区长者食堂', '上海市普陀区交暨路193弄3号一楼', 31.262935, 121.419693],
  ['北部片区社区长者食堂', '上海市普陀区连冠路196号', 31.289226, 121.396079]
].map(([name, address, latitude, longitude]) => ({
  name,
  category: '食堂',
  address,
  latitude,
  longitude,
  hours: '',
  description: '',
  pushedFingerprint: ''
}));

const existing = await prisma.place.findMany({
  where: { category: '食堂' },
  select: { id: true, name: true, address: true }
});
const planned = places.filter((place) => !existing.some((item) => item.name === place.name || item.address === place.address));
const duplicates = places.filter((place) => !planned.includes(place));
let backupPath = '';
let created = [];

if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-putuo-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-putuo-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(
    planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } }))
  );
}

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '上海市人民政府：普陀区社区老年助餐服务场所一览表（2025-10-09）',
  sourceUrl: 'https://www.shanghai.gov.cn/sqylfwqjzc/20251128/8bbcc043508545f89be3f6b97cfef296.html',
  mapVerification: 'Apple 地图中国区同址服务中心或楼栋 POI',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
