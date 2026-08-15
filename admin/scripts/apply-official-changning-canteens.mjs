import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-changning-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['新华路街道综合为老服务中心社区长者食堂', '上海市长宁区番禺路222弄50支弄6号', 31.205863, 121.426581],
  ['新华路街道AI社区长者食堂', '上海市长宁区法华镇路126号一楼', 31.202665, 121.432507],
  ['江苏路街道社区大食堂', '上海市长宁区东诸安浜路127号', 31.218228, 121.433795],
  ['华阳路街道社区长者食堂', '上海市长宁区安化路492号', 31.215558, 121.420497],
  ['华阳路街道华阳敬老院食堂社区长者食堂', '上海市长宁区长宁路396弄79号', 31.223347, 121.424711],
  ['华阳路街道万宏悦膳社区长者食堂', '上海市长宁区长宁支路187号', 31.226517, 121.42569],
  ['周家桥街道祥和社区长者食堂', '上海市长宁区武夷路658号', 31.212702, 121.417098],
  ['周家桥街道综合为老服务中心社区长者食堂', '上海市长宁区武夷路709弄26号', 31.214157, 121.416454],
  ['天山老年人日间服务中心（食堂）', '上海市长宁区天山四村122号3号楼1楼', 31.21332, 121.403179],
  ['天山路街道社区长者食堂', '上海市长宁区安顺路142号', 31.201718, 121.418488],
  ['仙霞社区长者食堂（茅台店）', '上海市长宁区茅台路298号甲', 31.209957, 121.398053],
  ['仙霞社区长者食堂（安龙店）', '上海市长宁区安龙路447弄4号', 31.205125, 121.386825],
  ['仙霞社区长者食堂（旗舰店）', '上海市长宁区茅台路632号', 31.210623, 121.387808],
  ['仙霞社区长者食堂（虹古店）', '上海市长宁区虹古路427弄', 31.203503, 121.385087],
  ['虹桥街道AI社区长者食堂', '上海市长宁区虹桥路1004号', 31.195446, 121.420106],
  ['虹桥街道社区综合为老服务中心社区长者食堂', '上海市长宁区中山西路1030弄8号', 31.198947, 121.413148],
  ['程家桥街道社区长者食堂', '上海市长宁区剑河路2359号', 31.190453, 121.375701],
  ['北新泾街道社区长者食堂', '上海市长宁区北渔路84号', 31.216075, 121.372775],
  ['新泾镇徐大厨社区长者食堂', '上海市长宁区平塘路470号', 31.211009, 121.365009]
].map(([name, address, latitude, longitude]) => ({ name, category: '食堂', address, latitude, longitude, hours: '', description: '', pushedFingerprint: '' }));

const existing = await prisma.place.findMany({ where: { category: '食堂' }, select: { id: true, name: true, address: true, latitude: true, longitude: true } });
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
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-changning-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-changning-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } })));
}

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '上海市长宁区民政局：长宁区社区长者食堂（2026-07-20）',
  sourceUrl: 'https://zwgk.shcn.gov.cn/xxgk/ylfwss-ylfw/2024/291/75291.html',
  mapVerification: 'Apple 地图中国区（高德底图）门牌或同址公共服务 POI',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates,
  heldForMapReview: [['新泾镇社区长者食堂', '上海市长宁区青溪路778号', '地图误匹配浦东清溪路，待精确门牌坐标复核']]
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条，待复核 1 条\n${reportPath}\n`);
await prisma.$disconnect();
