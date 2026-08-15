import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const researchDirectory = path.join(
  projectRoot,
  process.env.XHS_DISCOVERY_OUTPUT_DIR || 'data/research/xhs-discovery-2022-2026-08-08'
);
const approvedPath = path.join(researchDirectory, 'approved-candidates.json');
const reportPath = path.join(researchDirectory, 'apply-result.json');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[（）()【】[\]]/g, '')
    .replace(/上海市?|区|县|社区|街道|乡|镇|党群服务中心|文化活动中心|文化中心|服务中心|图书馆|分馆|馆|长者|老年|食堂|助餐点/g, '')
    .replace(/[·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

function extractRoadNumber(value) {
  return cleanText(value)
    .replace(/^上海市?/, '')
    .match(/([^区县\d,，。；;]{1,30}(?:公路|大道|路|街|道|弄|巷|村))(\d+)(?:弄(\d+))?号?/)
    ?.slice(1).filter(Boolean).join('') || '';
}

function validPoint(candidate) {
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  return latitude >= 30.6
    && latitude <= 31.9
    && longitude >= 120.8
    && longitude <= 122.2;
}

const payload = JSON.parse(await fs.readFile(approvedPath, 'utf8'));
const approved = (payload.candidates || []).filter((candidate) => candidate.approved === true);
const existing = await prisma.place.findMany({
  where: { category: { in: ['图书馆', '食堂'] } },
  select: { id: true, name: true, category: true, address: true }
});
const accepted = [];
const rejected = [];

for (const candidate of approved) {
  const reason = (() => {
    if (!['图书馆', '食堂'].includes(candidate.category)) return '分类不正确';
    if (!cleanText(candidate.name) || !cleanText(candidate.address)) return '名称或地址为空';
    if (!extractRoadNumber(candidate.address)) return '地址缺少道路门牌';
    if (!validPoint(candidate)) return '地图坐标无效';
    if (candidate.category === '图书馆') {
      if (!/图书馆/.test(candidate.name)) return '名称未明确包含图书馆';
      if (!cleanText(candidate.hours)) return '新增图书馆缺少开放时间';
      if (!cleanText(candidate.description)) return '新增图书馆缺少简介';
    }
    if (
      candidate.category === '食堂'
      && !/(社区|长者|老年|市民|邻里|助餐(?:点|服务|食堂))/.test(candidate.name)
    ) {
      return '食堂不属于公开社区助餐场所';
    }
    const duplicate = existing.find((place) => (
      place.category === candidate.category
      && (
        (
          normalizeName(place.name)
          && normalizeName(place.name) === normalizeName(candidate.name)
        )
        || (
          extractRoadNumber(place.address)
          && extractRoadNumber(place.address) === extractRoadNumber(candidate.address)
        )
      )
    ));
    return duplicate ? `与现有地点重复：${duplicate.name}` : '';
  })();
  if (reason) {
    rejected.push({ ...candidate, reason });
    continue;
  }
  accepted.push(candidate);
}

let backupPath = '';
if (applyChanges && accepted.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'xhs-discovery-2026-08-08');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(
    backupDirectory,
    `dev-before-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(accepted.map((candidate) => prisma.place.create({
    data: {
      name: cleanText(candidate.name),
      category: candidate.category,
      address: cleanText(candidate.address),
      latitude: Number(candidate.latitude),
      longitude: Number(candidate.longitude),
      hours: String(candidate.hours || '').trim(),
      description: String(candidate.description || '').trim(),
      pushedFingerprint: '',
      photos: {
        create: (candidate.photos || []).slice(0, 5).map((photo, index) => ({
          url: String(photo.url || photo),
          sortOrder: index
        }))
      }
    }
  })));
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  approved: approved.length,
  accepted,
  rejected
}, null, 2)}\n`);
process.stdout.write(
  `${applyChanges ? '已写入' : '预演'}新增 ${accepted.length} 条；拒绝 ${rejected.length} 条\n${reportPath}\n`
);
await prisma.$disconnect();
