import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-jiading-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['新旺社区长者食堂', '上海市嘉定区新源路776号-778号', 31.299688, 121.154013],
  ['方泰我嘉·邻里中心社区长者食堂', '上海市嘉定区宝安公路4535号一层A05室', 31.315975, 121.217125],
  ['黄渡我嘉·邻里中心社区长者食堂', '上海市嘉定区春塔路837号一层', 31.283447, 121.232746]
].map(([name, address, latitude, longitude]) => ({ name, category: '食堂', address, latitude, longitude, hours: '', description: '', pushedFingerprint: '' }));
const existing = await prisma.place.findMany({ where: { category: '食堂' }, select: { name: true, address: true, latitude: true, longitude: true } });
const distanceMeters = (a, b) => {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
};
const planned = places.filter((place) => !existing.some((item) => item.name === place.name || item.address === place.address || distanceMeters(item, place) < 55));
const duplicates = places.filter((place) => !planned.includes(place));
let backupPath = '';
let created = [];
if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-jiading-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-jiading-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } })));
}
await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '嘉定区人民政府：安亭镇新增3家长者食堂（2026-01-08）',
  sourceUrl: 'https://www.shanghai.gov.cn/nw17239/20260109/a456a5e8e6824791beddd204b77fc8c7.html',
  mapVerification: 'Apple 地图中国区（高德底图）门牌或同址邻里中心 POI',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
