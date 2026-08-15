import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'official-songjiang-canteens-2026-08-09');
const reportPath = path.join(researchDirectory, 'apply-result.json');

const places = [
  ['泗泾镇泗民HUI社区长者食堂', '上海市松江区泗泾镇泗通路225弄', 31.117318, 121.254514],
  ['九里亭街道杜巷社区长者食堂', '上海市松江区涞坊路288弄杜巷小区331号九里亭街道综合为老服务中心', 31.155618, 121.31701],
  ['车墩镇缘源社区长者食堂', '上海市松江区车墩镇车峰路199弄189号', 31.010956, 121.320256],
  ['中山街道社区食堂', '上海市松江区沪松路255弄18号', 31.026046, 121.244553],
  ['岳阳街道社区长者食堂', '上海市松江区人民北路196号', 31.015967, 121.227114],
  ['九亭颐景园社区长者食堂', '上海市松江区涞亭南路888弄91号2楼', 31.123652, 121.342373],
  ['新桥镇社区长者食堂', '上海市松江区新育路850号', 31.073228, 121.321928],
  ['石湖荡镇金汇村社区长者食堂', '上海市松江区石湖荡镇金汇村金星104号', 30.963561, 121.20031],
  ['佘山镇佘北社区长者食堂', '上海市松江区贡嘎山路300弄', 31.123425, 121.20749],
  ['永丰社区长者食堂', '上海市松江区草场浜路125弄36号1层', 31.005055, 121.197987],
  ['小昆山镇社区长者食堂', '上海市松江区翔昆路198号、208号', 31.029145, 121.119531],
  ['泗泾镇迪家苑社区食堂', '上海市松江区古楼公路259弄309号', 31.105359, 121.26346],
  ['九亭镇社区食堂', '上海市松江区文浦路150弄', 31.114329, 121.340792],
  ['佘山镇陈坊新苑社区长者食堂', '上海市松江区外青松公路8228弄52号', 31.103362, 121.179527],
  ['永丰街道谷水佳苑社区长者食堂', '上海市松江区富强路1585号', 30.993125, 121.232275],
  ['叶榭社区食堂（长者食堂）', '上海市松江区叶榭镇叶校路355弄113号101室1层', 30.938075, 121.314475],
  ['方松街道兰桥社区长者食堂', '上海市松江区思贤路1336、1338号2层2001室', 31.027948, 121.210996],
  ['洞泾镇光星社区长者食堂', '上海市松江区洞宁路655弄62幢643、645、647、649号', 31.075941, 121.279504],
  ['方松街道通波社区长者食堂', '上海市松江区通波路50号1幢C区', 31.02951, 121.239917],
  ['方松街道西部社区长者食堂', '上海市松江区新松江路2661号', 31.037431, 121.184114]
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

const heldForReview = [
  ['泖港镇胡光村社区长者食堂', '胡光公路306号未取得门牌级落点'],
  ['泗泾镇新凯片区社区食堂', '泗凯路667号未取得同址地图结果'],
  ['泖港镇黄桥村社区长者食堂', '官方门牌1085号与地图服务中心1088号存在偏差'],
  ['松南城社区长者食堂', '香亭路999弄1025号未取得楼栋级落点']
].map(([name, reason]) => ({ name, reason }));

const existing = await prisma.place.findMany({
  where: { category: '食堂' },
  select: { id: true, name: true, address: true, latitude: true, longitude: true }
});

const planned = [];
const duplicates = [];
for (const place of places) {
  const duplicate = existing.find((item) => item.name === place.name || item.address === place.address);
  if (duplicate) duplicates.push({ candidate: place, existing: duplicate });
  else planned.push(place);
}

let backupPath = '';
let created = [];
if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-songjiang-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-songjiang-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(
    planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } }))
  );
}

await fs.mkdir(researchDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '上海市松江区综合为老服务平台（松江区民政局）',
  mapVerification: 'Apple 地图中国区（高德底图），使用同址食堂、服务中心或楼栋 POI 核验落点',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates,
  heldForReview
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：计划新增 ${planned.length} 条，重复 ${duplicates.length} 条，暂缓 ${heldForReview.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
