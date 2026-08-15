import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const sourcePath = path.join(projectRoot, 'data', 'research', 'core-map-canteens-2026-08-09', 'results.json');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'core-map-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const coreDistricts = ['黄浦区', '徐汇区', '长宁区', '静安区', '杨浦区', '浦东新区', '闵行区', '嘉定区'];
const excludedPattern = /暂停营业|夜市|大排档|学校|大学|校区|员工食堂|公司食堂|工地食堂|机关食堂|金旺大食堂|金杨大食堂|我家食堂|餐饮管理|食之闻/;

const normalize = (value) => value
  .replace(/^中国/, '')
  .replace(/[\s·“”‘’()（）【】\[\]、,，.。\-—_]/g, '')
  .replace(/上海市/g, '');

const distanceMeters = (a, b) => {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
};

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const eligible = source.unique
  .map((place) => ({
    ...place,
    name: place.name.replace('杨浦区睦邻长社区者食堂', '杨浦区睦邻社区长者食堂'),
    district: coreDistricts.find((district) => place.address.includes(district)) || ''
  }))
  .filter((place) => place.district)
  .filter((place) => /(?:社区.*(?:食堂|饭堂)|(?:长者|老年).*(?:食堂|饭堂)|助餐.*(?:食堂|饭堂|餐厅))/.test(place.name))
  .filter((place) => !excludedPattern.test(place.name))
  .filter((place) => !/^(?:社区食堂|长者食堂)$/.test(place.name))
  .filter((place) => /(?:路|街|弄|号|镇|村|苑|店|门|楼|中心|广场|公寓|大厦|交叉口|菜市场)/.test(place.address.replace(/^中国上海市[^区]+区/, '')))
  .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));

const mapUnique = [];
for (const place of eligible.sort((a, b) => b.name.length - a.name.length)) {
  const duplicate = mapUnique.some((item) => normalize(item.name) === normalize(place.name)
    || normalize(item.address) === normalize(place.address)
    || distanceMeters(item, place) < 45);
  if (!duplicate) mapUnique.push(place);
}

const existing = await prisma.place.findMany({
  where: { category: '食堂' },
  select: { id: true, name: true, address: true, latitude: true, longitude: true }
});
const duplicates = [];
const planned = [];
for (const place of mapUnique) {
  const duplicate = existing.find((item) => normalize(item.name) === normalize(place.name)
    || normalize(item.address) === normalize(place.address)
    || distanceMeters(item, place) < 60);
  if (duplicate) {
    duplicates.push({ candidate: place, existing: duplicate });
    continue;
  }
  planned.push({
    name: place.name,
    category: '食堂',
    address: place.address.replace(/^中国/, ''),
    latitude: place.latitude,
    longitude: place.longitude,
    hours: '',
    description: '',
    pushedFingerprint: ''
  });
}

let backupPath = '';
let created = [];
if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'core-map-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-core-map-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(
    planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } }))
  );
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: 'Apple 地图中国区（高德底图）核心城区街道级搜索',
  sourcePath,
  sourcePolicy: '只保留名称明确标注社区、长者或老年助餐属性且位于重点八区的现存地图 POI；排除暂停营业、学校、单位内部、普通大食堂和夜市类结果',
  officialCorroboration: [
    '上海市民政局2025年度监测覆盖435家实际运营社区长者食堂',
    '浦东新区民政局确认截至2025年底已建成58家社区长者食堂',
    '各区政府现行食堂名单与运营报道'
  ],
  phonePolicy: '未采集、未保存电话',
  backupPath,
  rawUnique: source.uniqueCount,
  eligible: eligible.length,
  mapUnique: mapUnique.length,
  planned: planned.length,
  plannedPlaces: planned,
  created,
  duplicates
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：地图候选 ${source.uniqueCount}，合格 ${eligible.length}，去重后 ${mapUnique.length}，新增 ${planned.length}，与主库重复 ${duplicates.length}\n${reportPath}\n`);
await prisma.$disconnect();
