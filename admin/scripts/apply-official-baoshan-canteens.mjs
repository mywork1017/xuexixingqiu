import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-baoshan-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['张庙街道社区长者食堂', '上海市宝山区共江路656号', 31.330759, 121.454914],
  ['新顾城社区长者食堂', '上海市宝山区天仁路388号', 31.356684, 121.342879],
  ['共富新村社区长者食堂', '上海市宝山区共富路122号', 31.350116, 121.43197],
  ['罗店镇美罗家园社区长者食堂', '上海市宝山区罗南路39号南幢1楼', 31.383151, 121.341721]
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

const existing = await prisma.place.findMany({ where: { category: '食堂' }, select: { name: true, address: true } });
const planned = places.filter((place) => !existing.some((item) => item.name === place.name || item.address === place.address));
const duplicates = places.filter((place) => !planned.includes(place));
let backupPath = '';
let created = [];

if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-baoshan-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-baoshan-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(planned.map((place) => prisma.place.create({
    data: place,
    select: { id: true, name: true, address: true }
  })));
}

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '上海市人民政府、宝山区人民政府：2025年度优秀社区长者食堂名单',
  sourceUrl: 'https://www.shanghai.gov.cn/nw17239/20250915/761d9676d6984567b7dda2a507043c98.html',
  mapVerification: 'Apple 地图中国区同址食堂或服务中心 POI',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
