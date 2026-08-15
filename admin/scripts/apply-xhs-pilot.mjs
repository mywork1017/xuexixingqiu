import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const evidencePath = path.join(projectRoot, 'data', 'research', 'xhs-xuhui-huangpu', 'pilot-evidence.json');
const reportPath = path.join(projectRoot, 'data', 'research', 'xhs-xuhui-huangpu', 'pilot-result.json');
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));

const placeChanges = [
  {
    mode: 'update',
    id: 'place_cnh66f',
    slug: 'hongmei-library',
    data: {
      name: '虹梅街道党群服务中心图书馆',
      hours: '周二至周日8:30-17:00（周一闭馆）',
      description: '一楼提供饮水，馆内部分区域设有电源插座，座位够用，偶有楼外声音传入。'
    }
  },
  {
    mode: 'update',
    id: 'place_1319slo',
    slug: 'dapu-library',
    data: {
      name: '打浦桥街道党群服务中心图书馆',
      description: '馆内提供 Wi-Fi，设有电源插座，空间明亮，有活动时可能较嘈杂，厕所设有蹲位并提供厕纸。'
    }
  },
  {
    mode: 'update',
    id: 'place_ry9mpm',
    slug: 'bund-canteen',
    data: {
      description: '用餐空间较小，座位有限。'
    }
  },
  {
    mode: 'update',
    id: 'place_1os008v',
    slug: 'wuliqiao-canteen',
    data: {
      description: '用餐环境整洁，座位有限，晚餐时段可能拥挤。'
    }
  },
  {
    mode: 'create',
    slug: 'xuhong-canteen',
    data: {
      name: '徐家汇街道徐虹北片区社区长者食堂',
      category: '食堂',
      address: '上海市徐汇区徐虹北路11号一楼',
      latitude: 31.18995892,
      longitude: 121.42684479,
      hours: '',
      description: '用餐环境整洁，厕所干净且无异味，提供茶水。'
    }
  },
  {
    mode: 'create',
    slug: 'laoximen-canteen',
    data: {
      name: '老西门街道社区长者食堂',
      category: '食堂',
      address: '上海市黄浦区庄家街51弄1-2号',
      latitude: 31.22046185,
      longitude: 121.48835467,
      hours: '周一至周日11:00-17:00',
      description: '用餐环境整洁。'
    }
  },
  {
    mode: 'create',
    slug: 'cervantes-library',
    data: {
      name: '米盖尔·德·塞万提斯图书馆',
      category: '图书馆',
      address: '上海市徐汇区安福路208号2楼',
      latitude: 31.21416508,
      longitude: 121.44311076,
      hours: '周一至周六11:00-18:30',
      description: '阅览空间舒适，成人区与儿童区分开。'
    }
  },
  {
    mode: 'create',
    slug: 'dengdeng-library',
    data: {
      name: '上海当代艺术博物馆等等图书馆',
      category: '图书馆',
      address: '上海市黄浦区苗江路678号上海当代艺术博物馆3楼',
      latitude: 31.20110156,
      longitude: 121.49826427,
      hours: '周二至周日11:00-18:00（周一闭馆）',
      description: '馆内安静宽敞，设有电源插座，采光明亮。'
    }
  }
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/上海市?|徐汇区|黄浦区/g, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

function normalizeAddress(value) {
  return normalizeText(value)
    .replace(/一楼|二楼|三楼|1楼|2楼|3楼/g, '')
    .replace(/弄(\d+)[～~-](\d+)号/g, '弄$1-$2号');
}

function haversineMeters(first, second) {
  const values = [first.latitude, first.longitude, second.latitude, second.longitude].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [lat1, lon1, lat2, lon2] = values.map((value) => value * Math.PI / 180);
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function duplicateReason(candidate, existing) {
  if (candidate.category !== existing.category) return '';
  const candidateName = normalizeText(candidate.name);
  const existingName = normalizeText(existing.name);
  const candidateAddress = normalizeAddress(candidate.address);
  const existingAddress = normalizeAddress(existing.address);
  const distance = haversineMeters(candidate, existing);

  if (candidateAddress === existingAddress) return '同类地点地址一致';
  if (candidateName === existingName) return '同类地点名称一致';
  if (
    Math.min(candidateName.length, existingName.length) >= 6
    && (candidateName.includes(existingName) || existingName.includes(candidateName))
    && distance !== null
    && distance <= 150
  ) return '名称互相包含且距离不超过150米';
  return '';
}

function getPhotos(slug) {
  const place = evidence.places.find((item) => item.slug === slug);
  if (!place) throw new Error(`证据包缺少 ${slug}`);
  return place.finalImages.map((image, sortOrder) => ({
    url: image.url,
    sortOrder
  }));
}

const existingPlaces = await prisma.place.findMany({
  include: { photos: { orderBy: { sortOrder: 'asc' } } },
  orderBy: { name: 'asc' }
});
const duplicateChecks = [];
for (const change of placeChanges.filter((item) => item.mode === 'create')) {
  const matches = existingPlaces
    .map((existing) => ({
      id: existing.id,
      name: existing.name,
      address: existing.address,
      reason: duplicateReason(change.data, existing),
      distanceMeters: Math.round(haversineMeters(change.data, existing) || 0)
    }))
    .filter((item) => item.reason);
  duplicateChecks.push({ slug: change.slug, candidate: change.data, matches });
}

const blockingDuplicates = duplicateChecks.filter((item) => item.matches.length);
if (blockingDuplicates.length) {
  throw new Error(`新增候选疑似重复：${JSON.stringify(blockingDuplicates, null, 2)}`);
}

const before = {
  total: existingPlaces.length,
  libraries: existingPlaces.filter((place) => place.category === '图书馆').length,
  canteens: existingPlaces.filter((place) => place.category === '食堂').length
};
const operations = placeChanges.map((change) => ({
  mode: change.mode,
  id: change.id || null,
  slug: change.slug,
  data: change.data,
  photos: getPhotos(change.slug)
}));

if (applyChanges) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'xhs-xuhui-huangpu-1.0-2026-08-02');
  const backupPath = path.join(
    backupDirectory,
    `dev-before-pilot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);

  await prisma.$transaction(async (transaction) => {
    for (const operation of operations) {
      if (operation.mode === 'update') {
        await transaction.place.update({
          where: { id: operation.id },
          data: {
            ...operation.data,
            pushedFingerprint: '',
            photos: {
              deleteMany: { url: { startsWith: '/uploads/xhs-pilot/' } },
              create: operation.photos
            }
          }
        });
      } else {
        await transaction.place.create({
          data: {
            ...operation.data,
            pushedFingerprint: '',
            photos: { create: operation.photos }
          }
        });
      }
    }
  });
}

const afterPlaces = applyChanges
  ? await prisma.place.findMany({ include: { photos: true } })
  : existingPlaces;
const report = {
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  sourcePolicy: evidence.sourcePolicy,
  before,
  expectedAfter: {
    total: before.total + 4,
    libraries: before.libraries + 2,
    canteens: before.canteens + 2
  },
  actualAfter: {
    total: afterPlaces.length,
    libraries: afterPlaces.filter((place) => place.category === '图书馆').length,
    canteens: afterPlaces.filter((place) => place.category === '食堂').length
  },
  duplicateChecks,
  operations
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已写入' : '仅预览'}：${operations.length} 条，新增疑似重复 ${blockingDuplicates.length} 条\n`);
process.stdout.write(`${reportPath}\n`);
await prisma.$disconnect();
