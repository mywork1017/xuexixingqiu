import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'official-yangpu-canteens-2026-08-09');
const reportPath = path.join(reportDirectory, 'apply-result.json');
const places = [
  ['定海路街道隆昌路睦邻社区长者食堂', '上海市杨浦区隆昌路521号', 31.273241, 121.54429],
  ['定海路街道波阳路睦邻社区长者食堂', '上海市杨浦区波阳路301号', 31.273592, 121.552649],
  ['定海路街道睦邻社区长者食堂（福满佳）', '上海市杨浦区平凉路1890号', 31.269021, 121.544437],
  ['定海路街道腾越路睦邻社区长者食堂（熊猫饭堂）', '上海市杨浦区腾越路467号底层A02号商铺', 31.271256, 121.54975],
  ['定海路街道尚旺饭堂睦邻社区长者食堂', '上海市杨浦区平凉路2543号', 31.27658, 121.55267],
  ['大桥街道一康睦邻社区长者食堂', '上海市杨浦区杭州路349号', 31.261037, 121.538061],
  ['大桥街道睦邻社区长者食堂（熊猫饭堂）', '上海市杨浦区长阳路1830号', 31.271118, 121.538411],
  ['大桥街道贝贝饭堂睦邻社区长者食堂', '上海市杨浦区临青路369号', 31.26746, 121.539031],
  ['平凉路街道江浦路睦邻社区长者食堂', '上海市杨浦区江浦路745弄9号', 31.261917, 121.524148],
  ['平凉路街道霍山路睦邻社区长者食堂', '上海市杨浦区霍山路1058号一楼C区', 31.263163, 121.525288],
  ['平凉路街道保利和熹会睦邻社区长者食堂', '上海市杨浦区江浦路321号三楼', 31.256399, 121.528661],
  ['江浦路街道康善睦邻社区长者食堂', '上海市杨浦区辽源西路107号', 31.268428, 121.5124],
  ['江浦路街道双辽路睦邻社区长者食堂', '上海市杨浦区双辽路186号', 31.270741, 121.51825],
  ['江浦路街道打虎山路睦邻社区长者食堂', '上海市杨浦区打虎山路26号', 31.271013, 121.510044],
  ['长白新村街道长白长馨睦邻社区长者食堂', '上海市杨浦区延吉东路147号', 31.292855, 121.545055],
  ['长白新村街道图们路睦邻社区长者食堂', '上海市杨浦区图们路15号', 31.289766, 121.548524],
  ['长白新村社区综合为老服务中心睦邻社区长者食堂', '上海市杨浦区松花一村32号甲', 31.294884, 121.541176],
  ['汇晨睦邻社区长者食堂', '上海市杨浦区春江路815号', 31.296806, 121.55649],
  ['延吉新村街道鸿瑞兴睦邻社区长者食堂', '上海市杨浦区敦化路163号', 31.291095, 121.538508],
  ['延吉新村街道延吉五六村睦邻社区长者食堂', '上海市杨浦区延吉五村44号', 31.290495, 121.536703],
  ['延吉街道全润德饭堂睦邻社区长者食堂', '上海市杨浦区永吉路9号-3', 31.288244, 121.531788],
  ['控江路街道凤城三村睦邻社区长者食堂', '上海市杨浦区凤城三村31号', 31.281408, 121.520881],
  ['控江路街道靖宇南路睦邻社区长者食堂', '上海市杨浦区靖宇南路99弄16号', 31.283148, 121.525398],
  ['控江路街道多代园睦邻社区长者食堂', '上海市杨浦区控江路1031号-1035号、1035号甲', 31.280022, 121.531175],
  ['控江路街道快乐靖宇睦邻社区长者食堂', '上海市杨浦区靖宇中路120号', 31.284398, 121.527026],
  ['控江路街道凤三（4）江小杨饭堂睦邻社区长者食堂', '上海市杨浦区江浦路2098号', 31.280924, 121.517001],
  ['控江路街道双阳路江小杨饭堂睦邻社区长者食堂', '上海市杨浦区双阳路598号', 31.286513, 121.528858],
  ['四平路街道密云睦邻社区长者食堂', '上海市杨浦区密云路358号', 31.276954, 121.496617],
  ['四平路街道鞍山路熊猫饭堂睦邻社区长者食堂', '上海市杨浦区鞍山路104号', 31.276178, 121.51203],
  ['殷行街道综合为老服务中心睦邻社区长者食堂', '上海市杨浦区殷行一村74号', 31.325405, 121.541892],
  ['殷行街道久安养老院睦邻社区长者食堂', '上海市杨浦区国伟路300号E栋', 31.331801, 121.532776],
  ['殷行街道有滋有味睦邻社区长者食堂', '上海市杨浦区开鲁路360号-6号', 31.325036, 121.535627],
  ['殷行街道甬盛福睦邻社区长者食堂', '上海市杨浦区开鲁路460号', 31.325019, 121.530018],
  ['殷行街道震丰园社区长者食堂', '上海市杨浦区包头路436号一层', 31.31734, 121.538624],
  ['殷行街道国和1000睦邻小厨（熊猫食堂）', '上海市杨浦区国和路1000号1层111室', 31.318326, 121.52668],
  ['殷行街道长久顺睦邻社区长者食堂', '上海市杨浦区开鲁路208-2号底层', 31.324878, 121.538961],
  ['五角场街道国定支路睦邻社区长者食堂', '上海市杨浦区国定支路24号1楼', 31.30543, 121.505758],
  ['五角场街道大方记睦邻社区长者食堂', '上海市杨浦区政本路135号', 31.290224, 121.515317],
  ['五角场街道天益睦邻社区长者食堂', '上海市杨浦区国权路283号', 31.289747, 121.509248],
  ['长海路街道浣纱睦邻社区长者食堂', '上海市杨浦区国顺东路20号', 31.305019, 121.541579],
  ['长海路街道人和养老院睦邻社区长者食堂', '上海市杨浦区国和路968号', 31.318579, 121.524673],
  ['长海路街道市京睦邻社区长者食堂', '上海市杨浦区市光路611号', 31.321124, 121.523853],
  ['新江湾城街道清流环二路社区长者食堂', '上海市杨浦区清流环二路351号', 31.318663, 121.500614]
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
  ['长白新村街道228街坊睦邻社区长者食堂', '上海市杨浦区敦化路62号', '地图检索落在敦化路164号'],
  ['四平路街道同叶大厦睦邻社区长者食堂', '上海市杨浦区铁岭路38号', '地图检索落在铁岭路32号'],
  ['四平路街道中天大厦睦邻社区长者食堂', '上海市杨浦区四平路1115号', '地图只返回道路级结果'],
  ['殷行街道中原店睦邻社区长者食堂', '上海市杨浦区中原路56号', '地图检索落在中原路60弄附近']
];

const existing = await prisma.place.findMany({
  where: { category: '食堂' },
  select: { id: true, name: true, address: true }
});
const planned = places.filter((place) => !existing.some((item) => item.name === place.name || item.address === place.address));
const duplicates = places.filter((place) => !planned.includes(place));
let backupPath = '';
let created = [];

if (applyChanges && planned.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-yangpu-canteens-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-yangpu-canteens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(
    planned.map((place) => prisma.place.create({ data: place, select: { id: true, name: true, address: true } }))
  );
}

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: '上海市杨浦区人民政府：杨浦区睦邻社区长者食堂信息表（2024-09-30）',
  sourceUrl: 'https://www.shyp.gov.cn/zhengwu/mzj-sqjjylfw/2025/219/216e193468b312fa6aa4aa629b310858.html',
  mapVerification: 'Apple 地图中国区（高德底图）地址门牌核验',
  phonePolicy: '未采集、未保存电话',
  backupPath,
  planned: planned.length,
  created,
  duplicates,
  heldForReview
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${planned.length} 条，重复 ${duplicates.length} 条，待复核 ${heldForReview.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
