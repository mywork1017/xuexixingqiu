import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'xhs-full-2022-2026-08-02');
const stateDirectory = path.join(researchDirectory, 'places');
const reportPath = path.join(researchDirectory, 'apply-result.json');
const fieldCurationPath = path.join(researchDirectory, 'field-curation.json');
let fieldCuration = {};
try {
  fieldCuration = JSON.parse(await fs.readFile(fieldCurationPath, 'utf8'));
} catch {
  // Field curation is optional until evidence review finishes.
}

function descriptionClauses(value) {
  return String(value || '')
    .replace(/[。.!！]+$/g, '')
    .split(/[，,；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeDescription(current, incoming) {
  const clauses = [...descriptionClauses(current), ...descriptionClauses(incoming)];
  return clauses.length ? `${[...new Set(clauses)].join('，')}。` : '';
}

function defaultLibraryDescription(name) {
  if (/(少年儿童|少儿)/.test(name)) {
    return '面向少年儿童开放，提供少儿图书阅览和阅读空间。';
  }
  if (/(党群|党建)/.test(name)) {
    return '设在党群服务中心内，面向公众提供图书阅览、学习和自习空间。';
  }
  if (/(街道|镇|乡|社区|分馆)/.test(name)) {
    return '面向社区开放，提供图书阅览、学习和自习空间。';
  }
  return '公共图书馆，提供图书阅览、学习和自习空间。';
}

function extractDistrict(value) {
  return String(value || '').match(/浦东新区|黄浦区|徐汇区|长宁区|静安区|普陀区|虹口区|杨浦区|闵行区|宝山区|嘉定区|金山区|松江区|青浦区|奉贤区|崇明区/)?.[0] || '';
}

function extractRoadNumber(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .match(/([^区县\d,，。；;]{1,30}(?:公路|大道|路|街|道|弄|巷|村))(\d+)(?:弄(\d+))?号?/)?.slice(1).filter(Boolean).join('') || '';
}

function evidenceText(item) {
  return (item.evidence || []).map((entry) => String(entry.body || '')).join('\n');
}

function extractHours(item) {
  return evidenceText(item)
    .match(/(?:开放时间|营业时间)\s*[：:]\s*([^\n。]{4,120})/)?.[1]?.trim()
    || '';
}

function normalizeEvidenceAddress(currentAddress, suggestedAddress) {
  const value = String(suggestedAddress || '')
    .replace(/[#＃].*$/, '')
    .trim();
  if (!value) return '';
  const district = extractDistrict(currentAddress);
  return value.startsWith('上海')
    ? value
    : `上海市${district}${value.replace(new RegExp(`^${district}`), '')}`;
}

const stateFiles = (await fs.readdir(stateDirectory))
  .filter((filename) => filename.endsWith('.json'))
  .sort();
const evidence = [];
for (const filename of stateFiles) {
  const item = JSON.parse(await fs.readFile(path.join(stateDirectory, filename), 'utf8'));
  if (item.status === 'verified') evidence.push(item);
}

const places = await prisma.place.findMany({
  where: { category: { in: ['图书馆', '食堂'] } },
  include: { photos: { orderBy: { sortOrder: 'asc' } } },
  orderBy: { name: 'asc' }
});
const byId = new Map(places.map((place) => [place.id, place]));
const removals = places
  .filter((place) => (
    place.category === '图书馆'
    && (
      (
        /(书房|图书室|阅读空间|借阅点|流动图书)/.test(place.name)
        && !/图书馆/.test(place.name)
      )
      || place.name === '阅闲坊'
    )
  ))
  .map((place) => ({
    id: place.id,
    name: place.name,
    address: place.address,
    reason: '名称不属于固定公共图书馆'
  }));
const removalIds = new Set(removals.map((item) => item.id));
const operations = [];
const conflicts = [];

for (const item of evidence) {
  const place = byId.get(item.place.id);
  if (!place || removalIds.has(place.id)) continue;
  const data = {};
  const mergedDescription = mergeDescription(place.description, item.description);
  if (mergedDescription && mergedDescription !== place.description) data.description = mergedDescription;
  const suggestedHours = extractHours(item);
  if (!place.hours.trim() && suggestedHours) data.hours = suggestedHours;
  if (fieldCuration.hours?.[place.id]) data.hours = fieldCuration.hours[place.id];
  const suggestedAddress = normalizeEvidenceAddress(place.address, item.suggestedFields?.address);
  if (suggestedAddress && suggestedAddress !== place.address) {
    conflicts.push({
      id: place.id,
      name: place.name,
      field: 'address_review',
      current: place.address,
      evidence: suggestedAddress,
      sameRoadNumber: Boolean(
        extractRoadNumber(place.address)
        && extractRoadNumber(place.address) === extractRoadNumber(suggestedAddress)
      )
    });
  }

  const existingUrls = new Set(place.photos.map((photo) => photo.url));
  const slots = Math.max(0, 5 - place.photos.length);
  const newPhotos = (item.images || [])
    .filter((image) => !existingUrls.has(image.url))
    .slice(0, slots)
    .map((image, index) => ({
      url: image.url,
      sortOrder: place.photos.length + index
    }));
  if (Object.keys(data).length || newPhotos.length) {
    operations.push({
      id: place.id,
      name: place.name,
      data,
      photos: newPhotos,
      noteIds: item.evidence.map((entry) => entry.noteId)
    });
  }
}

for (const place of places) {
  if (
    place.category !== '图书馆'
    || removalIds.has(place.id)
    || place.description.trim()
  ) continue;
  const operation = operations.find((item) => item.id === place.id);
  if (operation?.data.description) continue;
  if (operation) {
    operation.data.description = defaultLibraryDescription(place.name);
  } else {
    operations.push({
      id: place.id,
      name: place.name,
      data: { description: defaultLibraryDescription(place.name) },
      photos: [],
      noteIds: []
    });
  }
}

const before = {
  total: places.length,
  withDescriptions: places.filter((place) => place.description.trim()).length,
  withPhotos: places.filter((place) => place.photos.length).length,
  photoCount: places.reduce((sum, place) => sum + place.photos.length, 0)
};
let backupPath = '';
if (applyChanges && (operations.length || removals.length)) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'xhs-full-2026-08-02');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(
    backupDirectory,
    `dev-before-full-update-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);

  await prisma.$transaction(async (transaction) => {
    for (const operation of operations) {
      await transaction.place.update({
        where: { id: operation.id },
        data: {
          ...operation.data,
          pushedFingerprint: '',
          photos: { create: operation.photos }
        }
      });
    }
    if (removals.length) {
      await transaction.place.deleteMany({
        where: { id: { in: removals.map((item) => item.id) } }
      });
    }
  });
}

const afterPlaces = applyChanges
  ? await prisma.place.findMany({
    where: { category: { in: ['图书馆', '食堂'] } },
    include: { photos: true }
  })
  : places.filter((place) => !removalIds.has(place.id)).map((place) => {
    const operation = operations.find((item) => item.id === place.id);
    return operation
      ? {
        ...place,
        ...operation.data,
        photos: [...place.photos, ...operation.photos]
      }
      : place;
  });
const after = {
  total: afterPlaces.length,
  withDescriptions: afterPlaces.filter((place) => place.description.trim()).length,
  withPhotos: afterPlaces.filter((place) => place.photos.length).length,
  photoCount: afterPlaces.reduce((sum, place) => sum + place.photos.length, 0)
};
const report = {
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  sourcePolicy: 'xhs-cli 正文与正文配图；未读取评论；仅接受 2022-01-01 以后内容并优先采用较新正文',
  descriptionPolicy: '图书馆无正文设施信息时，仅按名称与场所类型生成基础服务简介；食堂允许留空',
  curatedFields: fieldCuration,
  phonePolicy: '不采集、不导出、不展示电话；主库字段已移除',
  backupPath,
  verifiedPlaces: evidence.length,
  operations,
  conflicts,
  removals,
  before,
  after
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已写入' : '预演'}更新 ${operations.length} 条、移除 ${removals.length} 条；简介 ${before.withDescriptions}→${after.withDescriptions}；有图地点 ${before.withPhotos}→${after.withPhotos}\n`);
process.stdout.write(`${reportPath}\n`);
await prisma.$disconnect();
