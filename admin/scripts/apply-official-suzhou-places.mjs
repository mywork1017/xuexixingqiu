import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(projectRoot, 'admin', 'prisma', 'dev.db')}`;

const {
  auditPlaceRecord,
  distanceMeters,
  normalizeAddress,
  normalizeName,
  scoreMapCandidate
} = await import('../../scripts/lib/place-data-quality.mjs');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const sourceDirectory = path.join(projectRoot, 'data', 'research', 'suzhou-places-web-crawl-2026-08-16');
const enrichmentDirectory = path.join(projectRoot, 'data', 'research', 'suzhou-place-enrichment-web-crawl-2026-08-16');
const outputDirectory = path.join(projectRoot, 'data', 'research', 'suzhou-place-rebuild-2026-08-16');
const backupDirectory = path.join(projectRoot, 'data', 'backups', 'suzhou-place-rebuild-2026-08-16');
const databasePath = path.join(projectRoot, 'admin', 'prisma', 'dev.db');
const reportPath = path.join(outputDirectory, 'review.json');

let previousReport = null;
try {
  previousReport = JSON.parse(await fs.readFile(reportPath, 'utf8'));
} catch {
  // First run has no earlier application result to retain.
}

const sourcePayload = JSON.parse(await fs.readFile(path.join(sourceDirectory, 'candidates.json'), 'utf8'));
const geocodedPayload = JSON.parse(await fs.readFile(path.join(sourceDirectory, 'geocoded-candidates.json'), 'utf8'));
const sourceTexts = await Promise.all(sourcePayload.sources.map(async (source) => (
  fs.readFile(path.resolve(projectRoot, source.markdownPath), 'utf8')
)));

function isSuzhouAddress(address) {
  return /^苏州市|^苏州高新区/.test(String(address || ''));
}

function stableRows(rows) {
  return rows.map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    hours: place.hours,
    description: place.description,
    pushedFingerprint: place.pushedFingerprint,
    createdAt: place.createdAt.toISOString(),
    updatedAt: place.updatedAt.toISOString(),
    photos: place.photos.map((photo) => ({
      id: photo.id,
      url: photo.url,
      sortOrder: photo.sortOrder,
      createdAt: photo.createdAt.toISOString()
    }))
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function rowsHash(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(stableRows(rows))).digest('hex');
}

function canonicalAddress(place, mapResult) {
  if (/姑苏区|虎丘区|吴中区|相城区|吴江区|苏州工业园区|苏州高新区/.test(place.address)) {
    return place.address;
  }
  const district = mapResult.address.match(/(?:姑苏|虎丘|吴中|相城|吴江)区/)?.[0] || '';
  return place.address.replace(/^苏州市?/, `苏州市${district}`);
}

function policyIssue(place) {
  const text = `${place.name}${place.address}`;
  if (/(实验小学|实验中学|大学|学院|学校|校区)/.test(text)) return 'school_library';
  if (/(机关|检察院|法院|公安局|政务服务中心)/.test(text)) return 'restricted_institution';
  const source = sourceTexts[place.sourceIndex] || '';
  if (place.category === '图书馆' && !source.includes(place.sourceName)) return 'official_identity_missing';
  if (place.category === '食堂') {
    const houseNumber = place.address.match(/\d+(?:弄\d+)?号/)?.[0] || '';
    const publicMealEvidence = /社区|长者|老年|邻里|助餐|幸福食堂|苏心小厨/.test(source);
    if (!houseNumber || !source.replace(/\s+/g, '').includes(houseNumber) || !publicMealEvidence) {
      return 'official_public_meal_evidence_missing';
    }
  }
  return '';
}

function descriptionFor(place) {
  const descriptions = {
    '万年家邻里食堂': '面向社区居民提供午餐和晚餐',
    '光福镇福溪助餐点': '设于福溪社区老年人日间照料中心，为老年人提供助餐服务',
    '越溪街道珠村社区幸福食堂': '设于珠村华庭综合为老服务中心，可容纳230人',
    '桃源镇铜罗社区老年食堂': '提供早、中、晚三餐，可容纳约40人',
    '裕社·早点来苏心小厨（西美社区助餐点）': '沧浪街道西美社区公益助餐点'
  };
  return descriptions[place.name] || '';
}

function hasSamePlaceData(existing, planned) {
  return existing.name === planned.name
    && existing.category === planned.category
    && existing.address === planned.address
    && existing.latitude === planned.latitude
    && existing.longitude === planned.longitude
    && existing.hours === planned.hours
    && existing.description === planned.description
    && existing.pushedFingerprint === planned.pushedFingerprint;
}

async function enrichmentChannels(placeId) {
  if (!placeId) return [];
  const channels = [];
  for (const channel of ['baidu', 'sogou', 'weixin']) {
    const channelDirectory = path.join(enrichmentDirectory, 'pages', 'search', channel, placeId);
    try {
      const attempts = await fs.readdir(channelDirectory);
      const records = await Promise.all(attempts.map(async (attempt) => {
        const resultPath = path.join(channelDirectory, attempt, 'result.json');
        try {
          return JSON.parse(await fs.readFile(resultPath, 'utf8'));
        } catch {
          return null;
        }
      }));
      if (records.some((record) => record?.success)) channels.push(channel);
    } catch {
      // Missing discovery channel remains an explicit evidence gap.
    }
  }
  return channels;
}

const allPlacesBefore = await prisma.place.findMany({
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  orderBy: { id: 'asc' }
});
const shanghaiBefore = allPlacesBefore.filter((place) => /^上海市/.test(place.address));
const suzhouBefore = allPlacesBefore.filter((place) => isSuzhouAddress(place.address));
const shanghaiHashBefore = rowsHash(shanghaiBefore);
const geocodedByKey = new Map(geocodedPayload.records.map((place) => (
  [`${place.category}|${place.name}|${place.address}`, place]
)));
const held = [];
const approved = [];

for (const candidate of sourcePayload.candidates) {
  const issue = policyIssue(candidate);
  if (issue) {
    held.push({ name: candidate.name, address: candidate.address, stage: 'policy', reason: issue });
    continue;
  }
  const geocoded = geocodedByKey.get(`${candidate.category}|${candidate.name}|${candidate.address}`);
  const ranked = (geocoded?.mapCandidates || []).map((mapResult) => ({
    mapResult,
    quality: scoreMapCandidate(candidate, mapResult)
  })).sort((left, right) => right.quality.score - left.quality.score);
  const match = ranked.find((item) => item.quality.accepted);
  if (!match) {
    held.push({
      name: candidate.name,
      address: candidate.address,
      stage: 'map',
      reason: 'district_road_house_not_matched',
      bestCandidate: ranked[0] || null
    });
    continue;
  }
  const place = {
    name: candidate.name,
    category: candidate.category,
    address: canonicalAddress(candidate, match.mapResult),
    latitude: match.mapResult.latitude,
    longitude: match.mapResult.longitude,
    hours: '',
    description: descriptionFor(candidate),
    pushedFingerprint: ''
  };
  const auditIssues = auditPlaceRecord(place);
  if (auditIssues.length) {
    held.push({ name: candidate.name, address: candidate.address, stage: 'audit', reason: auditIssues });
    continue;
  }
  approved.push({
    ...place,
    sourceIndex: candidate.sourceIndex,
    sourceName: candidate.sourceName || candidate.name,
    mapQuery: geocoded.query,
    mapResult: match.mapResult,
    mapQuality: match.quality
  });
}

const exactDuplicates = [];
const seen = new Map();
for (const place of approved) {
  const key = `${place.category}|${normalizeName(place.name)}|${normalizeAddress(place.address)}`;
  if (seen.has(key)) exactDuplicates.push({ place: place.name, duplicateOf: seen.get(key) });
  else seen.set(key, place.name);
}
const nearbyPairs = [];
for (let left = 0; left < approved.length; left += 1) {
  for (let right = left + 1; right < approved.length; right += 1) {
    if (approved[left].category !== approved[right].category) continue;
    const meters = distanceMeters(approved[left], approved[right]);
    if (meters <= 60) nearbyPairs.push({
      meters: Number(meters.toFixed(1)),
      left: approved[left].name,
      right: approved[right].name
    });
  }
}
if (exactDuplicates.length || nearbyPairs.length) {
  throw new Error(`苏州重复审计未通过：完全重复 ${exactDuplicates.length}，60 米内同类 ${nearbyPairs.length}`);
}

const existingByName = new Map(suzhouBefore.map((place) => [`${place.category}|${place.name}`, place]));
const approvedNames = new Set(approved.map((place) => `${place.category}|${place.name}`));
const toDelete = suzhouBefore.filter((place) => !approvedNames.has(`${place.category}|${place.name}`));
const toCreate = approved.filter((place) => !existingByName.has(`${place.category}|${place.name}`));
const toUpdate = approved.filter((place) => {
  const existing = existingByName.get(`${place.category}|${place.name}`);
  return existing && !hasSamePlaceData(existing, place);
});
const evidence = await Promise.all(approved.map(async (place) => {
  const existing = existingByName.get(`${place.category}|${place.name}`);
  const channels = await enrichmentChannels(existing?.id);
  const source = sourcePayload.sources[place.sourceIndex];
  return {
    id: existing?.id || null,
    name: place.name,
    category: place.category,
    conclusions: {
      officialName: place.sourceName,
      address: place.address,
      coordinateSystem: 'GCJ-02',
      hours: '留空：无当前长期明确时段',
      description: place.description || '留空：无已终审实用事实',
      photos: '留空：无逐张终审图片'
    },
    officialSource: {
      title: source.title,
      url: source.url,
      archive: source.markdownPath,
      fetchedAt: source.fetchedAt,
      publishedAt: source.publishedAt,
      contentHash: source.contentHash
    },
    mapVerification: {
      provider: 'Apple 地图中国区（高德底图）',
      query: place.mapQuery,
      result: place.mapResult,
      score: place.mapQuality.score,
      districtMatch: place.mapQuality.districtMatch,
      streetNumberMatch: place.mapQuality.streetNumberMatch,
      nameMatch: place.mapQuality.nameMatch
    },
    discoveryChannels: channels,
    evidenceGap: channels.length >= 3 ? '' : `多渠道发现仅完成 ${channels.length}/3；不据此补写字段`
  };
}));

await fs.mkdir(outputDirectory, { recursive: true });
let backupPath = previousReport?.backupPath || previousReport?.previousApplication?.backupPath || '';
if (applyChanges && (toDelete.length || toCreate.length || toUpdate.length)) {
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-suzhou-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(databasePath, backupPath);
  await prisma.$transaction([
    ...toDelete.map((place) => prisma.place.delete({ where: { id: place.id } })),
    ...toUpdate.map((place) => prisma.place.update({
      where: { id: existingByName.get(`${place.category}|${place.name}`).id },
      data: {
        name: place.name,
        category: place.category,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        hours: place.hours,
        description: place.description,
        pushedFingerprint: ''
      }
    })),
    ...toCreate.map((place) => prisma.place.create({
      data: {
        name: place.name,
        category: place.category,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        hours: place.hours,
        description: place.description,
        pushedFingerprint: ''
      }
    }))
  ]);
}

const allPlacesAfter = await prisma.place.findMany({
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  orderBy: { id: 'asc' }
});
const shanghaiAfter = allPlacesAfter.filter((place) => /^上海市/.test(place.address));
const suzhouAfter = allPlacesAfter.filter((place) => isSuzhouAddress(place.address));
const shanghaiHashAfter = rowsHash(shanghaiAfter);
if (shanghaiHashBefore !== shanghaiHashAfter) {
  throw new Error(`上海数据发生变化：${shanghaiHashBefore} -> ${shanghaiHashAfter}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  ruleDocument: 'docs/place-data-maintenance.md',
  sourceCandidateCount: sourcePayload.candidates.length,
  approvedCount: approved.length,
  approvedByCategory: approved.reduce((counts, place) => ({
    ...counts,
    [place.category]: (counts[place.category] || 0) + 1
  }), {}),
  heldCount: held.length,
  held,
  exactDuplicates,
  nearbyPairs,
  changes: {
    create: toCreate.map((place) => place.name),
    update: toUpdate.map((place) => place.name),
    delete: toDelete.map((place) => place.name)
  },
  before: { shanghai: shanghaiBefore.length, suzhou: suzhouBefore.length, shanghaiHash: shanghaiHashBefore },
  after: { shanghai: shanghaiAfter.length, suzhou: suzhouAfter.length, shanghaiHash: shanghaiHashAfter },
  backupPath,
  previousApplication: !applyChanges && previousReport?.applied ? {
    changes: previousReport.changes,
    before: previousReport.before,
    after: previousReport.after,
    backupPath: previousReport.backupPath
  } : previousReport?.previousApplication || null,
  evidence
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：苏州通过 ${approved.length}，新增 ${toCreate.length}，更新 ${toUpdate.length}，删除 ${toDelete.length}，暂缓 ${held.length}；上海 ${shanghaiBefore.length} 条哈希一致\n`);
await prisma.$disconnect();
