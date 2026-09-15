import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(projectRoot, 'admin', 'prisma', 'dev.db')}`;

const { auditPlaceRecord, distanceMeters, normalizeAddress } = await import('../../scripts/lib/place-data-quality.mjs');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const pruneMissing = process.argv.includes('--prune');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'new-city-places-2026-08-16');
const backupDirectory = path.join(projectRoot, 'data', 'backups', 'new-city-places-2026-08-16');
const databasePath = path.join(projectRoot, 'admin', 'prisma', 'dev.db');
const payload = JSON.parse(await fs.readFile(path.join(researchDirectory, 'geocoded-candidates.json'), 'utf8'));
const sourcePayload = JSON.parse(await fs.readFile(path.join(researchDirectory, 'candidates.json'), 'utf8'));
const sourceCandidateByKey = new Map(sourcePayload.candidates.map((place) => [
  `${place.category}|${place.name}|${place.address}`,
  place
]));
const targetCities = new Set(['嘉兴市', '南通市', '无锡市', '镇江市']);

function stableRows(rows) {
  return rows.map((place) => ({
    id: place.id, name: place.name, category: place.category, address: place.address,
    latitude: place.latitude, longitude: place.longitude, hours: place.hours,
    description: place.description, pushedFingerprint: place.pushedFingerprint,
    photos: place.photos.map((photo) => ({ id: photo.id, url: photo.url, sortOrder: photo.sortOrder }))
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function rowsHash(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(stableRows(rows))).digest('hex');
}

function cleanMapAddress(value) {
  return String(value || '')
    .replace(/^中国(?:浙江|江苏)省/, '')
    .replace(/^中国/, '')
    .trim();
}

function canonicalAddress(record) {
  const mapResult = record.mapResult || {};
  const mapAddress = cleanMapAddress(mapResult.address)
    || (/(?:路|街|巷|弄|大道)\d+(?:-\d+)?号/.test(mapResult.name || '') ? cleanMapAddress(mapResult.name) : '');
  const sourceAddress = String(record.address || '').replace(/^江苏省|^浙江省/, '');
  const mapDistrict = mapAddress.match(/(?:南湖|秀洲|梁溪|锡山|惠山|滨湖|新吴|京口|润州|丹徒|崇川|通州|海门)区|(?:嘉善|海盐|如东)县|(?:海宁|平湖|桐乡|海安|启东|如皋|江阴|宜兴|丹阳|扬中|句容)市/)?.[0] || '';
  if (/(?:路|街|巷|弄|大道|里)\d+(?:-\d+)?号/.test(sourceAddress)) {
    if (sourceAddress.startsWith(record.city)) return sourceAddress;
    if (mapDistrict && !sourceAddress.includes(mapDistrict)) return `${record.city}${mapDistrict}${sourceAddress}`;
    return `${record.city}${sourceAddress}`;
  }
  if (mapAddress.startsWith(record.city) && /(?:区|县|市)/.test(mapAddress.slice(record.city.length))) {
    return mapAddress;
  }
  if (sourceAddress.startsWith(record.city)) return sourceAddress;
  if (mapAddress && mapDistrict) return mapAddress.startsWith(record.city) ? mapAddress : `${record.city}${mapAddress}`;
  return `${record.city}${mapDistrict}${sourceAddress}`;
}

function stableId(record) {
  return `city-${crypto.createHash('sha256').update(`${record.category}|${record.name}|${canonicalAddress(record)}`).digest('hex').slice(0, 24)}`;
}

const allBefore = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const nonTargetBefore = allBefore.filter((place) => ![...targetCities].some((city) => place.address.startsWith(city)));
const nonTargetHashBefore = rowsHash(nonTargetBefore);
const existingTarget = allBefore.filter((place) => [...targetCities].some((city) => place.address.startsWith(city)));
const existingByIdentity = new Map(existingTarget.map((place) => [`${place.category}|${place.name}`, place]));
const approved = [];
const held = [];
for (const record of payload.records) {
  if (record.status !== 'approved' || !record.mapResult) {
    held.push({ name: record.name, city: record.city, stage: 'map', reason: record.status });
    continue;
  }
  const existingIdentity = existingByIdentity.get(`${record.category}|${record.name}`);
  const place = {
    id: existingIdentity?.id || stableId(record), name: record.name, category: record.category,
    address: canonicalAddress(record), latitude: Number(record.mapResult.latitude),
    longitude: Number(record.mapResult.longitude), hours: record.hours || '',
    description: record.description || '', pushedFingerprint: ''
  };
  const issues = auditPlaceRecord(place);
  if (issues.length) {
    held.push({ name: record.name, city: record.city, stage: 'audit', reason: issues, place });
    continue;
  }
  const sourceCandidate = sourceCandidateByKey.get(`${record.category}|${record.name}|${record.address}`);
  if (!sourceCandidate) {
    held.push({ name: record.name, city: record.city, stage: 'source', reason: 'candidate_source_missing' });
    continue;
  }
  approved.push({ ...place, sourceIndex: sourceCandidate.sourceIndex, mapResult: record.mapResult, mapQuery: record.query });
}

const duplicateKeys = new Map();
const duplicates = [];
for (const place of approved) {
  const strictName = place.name.toLowerCase().replace(/[\s·•，,。.：:;；/\\_-—“”"'’]/g, '');
  const key = `${place.category}|${strictName}|${normalizeAddress(place.address)}`;
  if (duplicateKeys.has(key)) duplicates.push({ name: place.name, duplicateOf: duplicateKeys.get(key) });
  duplicateKeys.set(key, place.name);
}
if (duplicates.length) throw new Error(`新城市候选存在 ${duplicates.length} 条完全重复`);

const nearbyPairs = [];
for (let left = 0; left < approved.length; left += 1) {
  for (let right = left + 1; right < approved.length; right += 1) {
    if (approved[left].category !== approved[right].category) continue;
    const meters = distanceMeters(approved[left], approved[right]);
    if (meters <= 60) nearbyPairs.push({ left: approved[left].name, right: approved[right].name, meters: Number(meters.toFixed(1)) });
  }
}

const existingById = new Map(existingTarget.map((place) => [place.id, place]));
const approvedIds = new Set(approved.map((place) => place.id));
const toCreate = approved.filter((place) => !existingById.has(place.id));
const toUpdate = approved.filter((place) => {
  const existing = existingById.get(place.id);
  return existing && ['name', 'category', 'address', 'latitude', 'longitude', 'hours', 'description']
    .some((field) => existing[field] !== place[field]);
});
const toDelete = pruneMissing ? existingTarget.filter((place) => !approvedIds.has(place.id)) : [];
let backupPath = '';
if (applyChanges && (toCreate.length || toUpdate.length || toDelete.length)) {
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-new-cities-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(databasePath, backupPath);
  await prisma.$transaction([
    ...toDelete.map((place) => prisma.place.delete({ where: { id: place.id } })),
    ...toUpdate.map((place) => prisma.place.update({
      where: { id: place.id },
      data: { name: place.name, category: place.category, address: place.address, latitude: place.latitude,
        longitude: place.longitude, hours: place.hours, description: place.description, pushedFingerprint: '' }
    })),
    ...toCreate.map((place) => prisma.place.create({ data: {
      id: place.id, name: place.name, category: place.category, address: place.address,
      latitude: place.latitude, longitude: place.longitude, hours: place.hours,
      description: place.description, pushedFingerprint: ''
    } }))
  ]);
}

const allAfter = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const nonTargetHashAfter = rowsHash(allAfter.filter((place) => ![...targetCities].some((city) => place.address.startsWith(city))));
if (nonTargetHashBefore !== nonTargetHashAfter) throw new Error('非目标城市数据哈希发生变化');
const evidence = approved.map((place) => ({
  id: place.id, name: place.name, category: place.category,
  conclusions: { address: place.address, coordinateSystem: 'GCJ-02', hours: place.hours || '留空：无当前长期时段', description: place.description || '留空：无已终审实用事实', photos: '待逐张终审' },
  officialSource: sourcePayload.sources[place.sourceIndex],
  mapVerification: { provider: 'Apple 地图中国区（高德底图）', query: place.mapQuery, result: place.mapResult }
}));
const report = {
  generatedAt: new Date().toISOString(), applied: applyChanges, backupPath,
  candidateCount: payload.records.length, approvedCount: approved.length, heldCount: held.length,
  toCreate: toCreate.map((place) => place.name), toUpdate: toUpdate.map((place) => place.name),
  toDelete: toDelete.map((place) => place.name), nearbyPairs, held,
  nonTargetHashBefore, nonTargetHashAfter, evidence
};
await fs.writeFile(path.join(researchDirectory, applyChanges ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  applied: applyChanges, approved: approved.length, held: held.length,
  create: toCreate.length, update: toUpdate.length, delete: toDelete.length,
  nearbyPairs: nearbyPairs.length, backupPath
}, null, 2));
await prisma.$disconnect();
