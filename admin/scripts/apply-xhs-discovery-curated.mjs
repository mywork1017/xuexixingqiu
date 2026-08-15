import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const researchDirectory = path.join(
  projectRoot,
  'data',
  'research',
  'xhs-discovery-2022-2026-08-08'
);
const reportPath = path.join(researchDirectory, 'curated-apply-result.json');

const updates = [
  {
    id: 'place_5opekl',
    data: {
      address: '上海市静安区平型关路1179号大宁路街道党群服务中心3楼',
      latitude: 31.28324287641986,
      longitude: 121.4575692065098,
      hours: '周一至周日8:30-20:30',
      description: '设在大宁路街道党群服务中心3楼，环境宽敞明亮，座位较多，部分座位设有电源插座。'
    },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/6904ae790000000004010bcc/${name}`),
    evidence: ['6904ae790000000004010bcc', '静安区政府及静安区图书馆公开地址']
  },
  {
    id: 'place_1lnmzzd',
    data: { description: '馆内空间较大，设有电源插座和 Wi-Fi，自习与阅读环境安静。' },
    photos: ['/uploads/xhs-discovery/654dc8db000000003203550b/01.webp'],
    evidence: ['654dc8db000000003203550b']
  },
  {
    id: 'place_yhatmy',
    data: { description: '馆内设有自修室、多媒体阅览室和海关专题阅览室，部分阅览桌配有电源插座，四楼提供热水，各层设有厕所。' },
    photos: ['01.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/6a0e59d8000000003503b608/${name}`),
    evidence: ['6a0e59d8000000003503b608']
  },
  {
    id: 'place_7sdwge',
    data: { description: '馆内设有少儿阅览区、茶水间、厕所和 Wi-Fi，部分自习座位配有电源插座。' },
    photos: ['02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/69a2c5b9000000001b014390/${name}`),
    evidence: ['69a2c5b9000000001b014390']
  },
  {
    id: 'place_4h6j5r',
    data: { description: '四至五楼及八至九楼设有自习座位，部分桌面配有电源插座；馆内提供 Wi-Fi、饮水和厕所。' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/68a58195000000001d00193f/${name}`),
    evidence: ['68a58195000000001d00193f', '696a06fd000000001a028eb1']
  },
  {
    id: 'place_8j7n5z',
    data: { description: '设在永丰街道社区党群服务中心2楼，设有成人借阅区、亲子共读区和安静自习区。' },
    photos: ['01.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/69f466c9000000003703633e/${name}`),
    evidence: ['69f466c9000000003703633e']
  },
  {
    id: 'place_mrspz6',
    data: { hours: '周一13:30-19:00（仅开放报刊阅览），周二至周日9:00-19:00' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/690caecb000000000402be5d/${name}`),
    evidence: ['690caecb000000000402be5d']
  },
  {
    id: 'place_ck6c9n',
    data: { description: '三楼设有较多自习座位，部分区域配有电源插座。' },
    photos: ['/uploads/xhs-discovery/68d00500000000000b0109d0/02.webp'],
    evidence: ['68d00500000000000b0109d0']
  },
  {
    id: 'place_1feigbo',
    data: {
      hours: '每日8:30-20:00',
      description: '设有文献阅览区、少儿馆和二楼自修室，提供存包、饮水、电源插座和 Wi-Fi。'
    },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/6a4894b2000000001700950a/${name}`),
    evidence: ['6a4894b2000000001700950a']
  },
  {
    id: 'place_mp3bgd',
    data: { description: '各层阅览区设有电源插座、饮水机和厕所，二至三楼设有储物柜，自习桌面较宽敞。' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/69281d9d000000001e02c8c3/${name}`),
    evidence: ['69281d9d000000001e02c8c3']
  },
  {
    id: 'place_1coimat',
    data: { description: '馆内设有报刊阅览区、少儿借阅区、数字阅览区和自修区，环境安静。' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/6a06baeb000000003503bf87/${name}`),
    evidence: ['6a06baeb000000003503bf87']
  },
  {
    id: 'place_1e6r5z7',
    data: { description: '馆内设有电源插座和 Wi-Fi，靠窗区域可供阅读和自习。' },
    photos: ['/uploads/xhs-discovery/66612393000000001303fe85/01.webp'],
    evidence: ['66612393000000001303fe85']
  },
  {
    id: 'place_z7116a',
    data: { description: '馆内设有电源插座和 Wi-Fi，可供阅读和自习。' },
    photos: ['/uploads/xhs-discovery/6928066a000000001e0244b9/02.webp'],
    evidence: ['6928066a000000001e0244b9']
  },
  {
    id: 'place_i6ffg0',
    data: { description: '设在党群服务中心3楼，馆内设有电源插座和 Wi-Fi，并配有咖啡馆、健身房和乒乓球室。' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/6a44ad830000000021008298/${name}`),
    evidence: ['6a44ad830000000021008298']
  },
  {
    id: 'place_1rcw0fw',
    data: { description: '馆内设有儿童阅读区、非遗工坊和自习空间，环境整洁安静。' },
    photos: ['01.webp', '02.webp', '03.webp'].map((name) => `/uploads/xhs-discovery/69dd9a7a000000001a02b76a/${name}`),
    evidence: ['69dd9a7a000000001a02b76a']
  },
  {
    id: 'place_lbk3a7',
    data: { description: '由旧上海市立图书馆历史建筑修缮而成，馆内提供图书阅览、学习和自习空间。' },
    photos: ['/uploads/xhs-discovery/6a54db45000000001702ef9f/03.webp'],
    evidence: ['6a54db45000000001702ef9f']
  },
  {
    id: 'place_bgg3t7',
    data: { description: '馆内设有两个自习区，桌面配有电源插座和阅读灯，提供 Wi-Fi、热水及少儿阅读空间。' },
    photos: [],
    evidence: ['69688cd2000000002102ae09']
  },
  {
    id: 'place_ht3l3d',
    data: { hours: '8:30-17:30（周一仅开放阅览，法定节假日开放时间另行通知）' },
    photos: [],
    evidence: ['清除营业时间字段中的电话号码']
  }
];

const newPlace = {
  name: '广富林街道社区（长者）食堂',
  category: '食堂',
  address: '上海市松江区谷阳北路2760号二楼',
  latitude: 31.05532145811775,
  longitude: 121.2367490922577,
  hours: '',
  description: '',
  photos: [
    '/uploads/xhs-discovery/68b5a4dc000000001c00cbf9/02.webp',
    '/uploads/xhs-discovery/68b5a4dc000000001c00cbf9/03.webp'
  ],
  evidence: ['68b5a4dc000000001c00cbf9', '松江区政府及松江区综合为老服务平台公开信息']
};

const rejectedCandidates = [
  { noteId: '654dc8db000000003203550b', decision: '对应旧库崇明区图书馆，转为内容更新' },
  { noteId: '6a0e59d8000000003503b608', decision: '对应旧库静安区图书馆（新闸路），转为内容更新' },
  { noteId: '69a2c5b9000000001b014390', decision: '对应旧库古美路街道图书馆（东馆），转为内容更新' },
  { noteId: '6904ae790000000004010bcc', decision: '对应大宁路街道图书馆新馆，修正旧库地址，不重复新增' },
  { noteId: '69dd9a7a000000001a02b76a', decision: '对应旧库殷行街道图书馆，自动重复关联错误已人工修正' }
];

async function addPhotos(tx, placeId, urls) {
  const existing = await tx.placePhoto.findMany({ where: { placeId }, orderBy: { sortOrder: 'asc' } });
  const known = new Set(existing.map((photo) => photo.url));
  const available = Math.max(0, 5 - existing.length);
  const additions = urls.filter((url) => !known.has(url)).slice(0, available);
  if (!additions.length) return 0;
  await tx.placePhoto.createMany({
    data: additions.map((url, index) => ({ placeId, url, sortOrder: existing.length + index }))
  });
  return additions.length;
}

const duplicateFood = await prisma.place.findFirst({
  where: {
    category: '食堂',
    OR: [
      { name: newPlace.name },
      { address: newPlace.address }
    ]
  },
  select: { id: true, name: true }
});

let backupPath = '';
const appliedUpdates = [];
let createdPlace = null;
if (applyChanges) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'xhs-discovery-2026-08-08');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(
    backupDirectory,
    `dev-before-curated-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const place = await tx.place.update({
        where: { id: update.id },
        data: { ...update.data, pushedFingerprint: '' },
        select: { id: true, name: true }
      });
      const addedPhotos = await addPhotos(tx, place.id, update.photos);
      appliedUpdates.push({ ...place, addedPhotos, evidence: update.evidence });
    }
    if (!duplicateFood) {
      const created = await tx.place.create({
        data: {
          name: newPlace.name,
          category: newPlace.category,
          address: newPlace.address,
          latitude: newPlace.latitude,
          longitude: newPlace.longitude,
          hours: newPlace.hours,
          description: newPlace.description,
          pushedFingerprint: '',
          photos: {
            create: newPlace.photos.map((url, index) => ({ url, sortOrder: index }))
          }
        },
        select: { id: true, name: true, address: true }
      });
      createdPlace = { ...created, evidence: newPlace.evidence };
    }
  });
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  discovery: { totalQueries: 80, completedQueries: 80, errorQueries: 0 },
  updatesPlanned: updates.length,
  appliedUpdates,
  newPlace: duplicateFood
    ? { accepted: false, reason: `已存在：${duplicateFood.name}` }
    : { accepted: true, candidate: newPlace, createdPlace },
  rejectedCandidates,
  sourcePolicy: '小红书2022年以来正文与正文图片；未读取评论；地址与场所资格另用政府及公共服务平台核验'
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：更新 ${updates.length} 条，新增 ${duplicateFood ? 0 : 1} 条\n${reportPath}\n`);
await prisma.$disconnect();
