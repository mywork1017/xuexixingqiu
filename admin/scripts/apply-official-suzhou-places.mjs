import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(projectRoot, 'admin', 'prisma', 'dev.db')}`;

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'suzhou-places-web-crawl-2026-08-16');
const candidatesPath = path.join(researchDirectory, 'candidates.json');
const geocodedPath = path.join(researchDirectory, 'geocoded-candidates.json');
const reportPath = path.join(researchDirectory, 'apply-result.json');

const sourcePayload = JSON.parse(await fs.readFile(candidatesPath, 'utf8'));
const sourceTexts = await Promise.all(sourcePayload.sources.map(async (source) => (
  fs.readFile(path.resolve(projectRoot, source.markdownPath), 'utf8')
)));
const existingPlaces = await prisma.place.findMany({
  select: { id: true, name: true, category: true, address: true }
});

function normalize(value) {
  return String(value || '')
    .replace(/上海市?|苏州市?|社区|街道|乡|镇|文化活动中心|文化中心|服务中心|分馆|馆/g, '')
    .replace(/[（）()，,。.、:：;；/\\_\-—\s·]/g, '')
    .toLowerCase();
}

function hasSourceEvidence(place) {
  const source = sourceTexts[place.sourceIndex] || '';
  if (place.category === '图书馆') return source.includes(place.sourceName);
  const houseNumber = place.address.match(/\d+(?:弄\d+)?号/)?.[0] || '';
  return Boolean(houseNumber) && source.replace(/\s+/g, '').includes(houseNumber.replace(/\s+/g, ''));
}

function hasCompleteAddress(address) {
  const value = String(address || '').replace(/\s+/g, '');
  const numberedRoad = /(?:公路|大道|路|街|道|弄|巷|村)\d+/.test(value);
  const structuredLocator = /(?:花园|宅)\d+号|村[^,，]*\d+(?:组[^,，]*\d+)?号|(?:路|街|弄).*(?:交叉口|地铁站).{0,12}\d+米|(?:地铁|轨交).{0,30}(?:站|口)|(?:小区|花园|公寓|大楼|大厦|中心|广场|菜市场|园区|邻里中心).*(?:门|楼|层|旁).{0,12}(?:\d+米)?|(?:村|苑|酒店|园|城|工业区).{0,20}(?:门|旁).{0,10}(?:\d+米)?/.test(value);
  return numberedRoad || structuredLocator;
}

function exclusionReason(place) {
  const text = `${place.name}${place.address}`;
  if (/(实验小学|实验中学|大学|学院|学校|校区)/.test(text)) return 'school_library';
  if (/(机关|检察院|法院|公安局|政务服务中心)/.test(text)) return 'restricted_institution';
  if (!hasSourceEvidence(place)) return 'source_evidence_mismatch';
  if (!hasCompleteAddress(place.address)) return 'incomplete_address';
  return '';
}

const heldForPolicy = [];
const eligible = sourcePayload.candidates.filter((place) => {
  const reason = exclusionReason(place);
  if (reason) heldForPolicy.push({ name: place.name, address: place.address, reason });
  return !reason;
});

const geocodedPayload = JSON.parse(await fs.readFile(geocodedPath, 'utf8'));
const eligibleNames = new Set(eligible.map((place) => `${place.category}|${place.name}|${place.address}`));

const heldForLocation = [];
const approved = geocodedPayload.records.filter((place) => {
  const key = `${place.category}|${place.name}|${place.address}`;
  if (!eligibleNames.has(key)) return false;
  const accepted = place.status === 'approved' && place.mapResult;
  if (!accepted) {
    heldForLocation.push({
      name: place.name,
      address: place.address,
      reason: place.error || `mapStatus=${place.status}, score=${place.mapResult?.score || 0}`
    });
  }
  return accepted;
});

const duplicates = [];
const planned = approved.filter((place) => {
  const duplicate = existingPlaces.find((existing) => (
    existing.category === place.category
    && (normalize(existing.name) === normalize(place.name) || normalize(existing.address) === normalize(place.address))
  ));
  if (duplicate) duplicates.push({ candidate: place.name, existing: duplicate });
  return !duplicate;
}).map((place) => ({
  name: place.name,
  category: place.category,
  address: /姑苏区|虎丘区|吴中区|相城区|吴江区|工业园区|高新区/.test(place.address)
    ? place.address
    : place.address.replace(/^苏州市?/, `苏州市${place.mapResult.address.match(/(?:姑苏|虎丘|吴中|相城|吴江)区/)?.[0] || ''}`),
  latitude: place.mapResult.latitude,
  longitude: place.mapResult.longitude,
  hours: place.hours || '',
  description: place.description || '',
  pushedFingerprint: ''
}));

let backupPath = '';
let created = [];
const backupDirectory = path.join(projectRoot, 'data', 'backups', 'official-suzhou-places-2026-08-16');
if (applyChanges && planned.length) {
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-suzhou-places-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(projectRoot, 'admin', 'prisma', 'dev.db'), backupPath);
  created = await prisma.$transaction(
    planned.map((place) => prisma.place.create({
      data: place,
      select: { id: true, name: true, category: true, address: true }
    }))
  );
} else {
  try {
    const backups = (await fs.readdir(backupDirectory)).sort();
    if (backups.length) backupPath = path.join(backupDirectory, backups.at(-1));
  } catch {
    backupPath = '';
  }
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  crawlMethod: sourcePayload.method,
  sourceCount: sourcePayload.sources.length,
  sourceFailures: sourcePayload.sources.filter((source) => !source.success),
  candidateCount: sourcePayload.candidates.length,
  approvedCount: approved.length,
  plannedCount: planned.length,
  created,
  duplicates,
  heldForPolicy,
  heldForLocation,
  backupPath
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${created.length || planned.length}，政策暂缓 ${heldForPolicy.length}，坐标暂缓 ${heldForLocation.length}，重复 ${duplicates.length}\n${reportPath}\n`);
await prisma.$disconnect();
