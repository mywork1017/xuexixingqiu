import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(projectRoot, 'admin', 'prisma', 'dev.db')}`;

const { auditPlaceRecord, distanceMeters, extractDistrict, normalizeAddress } = await import('../../scripts/lib/place-data-quality.mjs');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'nature-places-2026-09-12');
const backupDirectory = path.join(projectRoot, 'data', 'backups', 'nature-places-2026-09-12');
const databasePath = path.join(projectRoot, 'admin', 'prisma', 'dev.db');
const geocodedPayload = JSON.parse(await fs.readFile(path.join(researchDirectory, 'geocoded-candidates.json'), 'utf8'));
const photoPayload = JSON.parse(await fs.readFile(path.join(researchDirectory, 'photo-preparation-report.json'), 'utf8'));

const rejectedPhotoNames = new Set([
  '和风公园', '新虹法治文化主题公园', '浦东牡丹园', '竹园中心绿地', '园御园', '西部绿苑',
  '中医药文化园', '银翔湖公园', '诸翟公园', '泖港公园', '南水关公园', '平阳双拥公园',
  '滨海公园', '丹巴公园', '合庆公园', '济阳公园', '长青公园', '亨林公园', '张堰公园',
  '大宁公园', '交通公园', '闸北公园', '上南公园'
]);
const approvedPhotoByName = new Map(photoPayload.records
  .filter((record) => record.status === 'prepared' && !rejectedPhotoNames.has(record.name))
  .map((record) => [record.name, record]));

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

function cleanAddress(value) {
  return String(value || '')
    .replace(/^中国/, '')
    .replace(/^(?:上海|江苏|浙江)省/, '')
    .replace(/^(上海市){2,}/, '上海市')
    .replace(/^(苏州市){2,}/, '苏州市')
    .replace(/^(南通市){2,}/, '南通市')
    .replace(/^(无锡市){2,}/, '无锡市')
    .replace(/^(嘉兴市){2,}/, '嘉兴市')
    .replace(/^(镇江市){2,}/, '镇江市')
    .trim();
}

function districtFrom(...values) {
  return extractDistrict(values.map((value) => String(value || '')).join(' '));
}

function canonicalAddress(record) {
  const mapAddress = cleanAddress(record.mapResult?.address);
  const hint = cleanAddress(record.addressHint);
  const city = record.city;
  const district = districtFrom(mapAddress, record.district, hint);
  const locatorPattern = /(?:路|街|巷|弄|大道|公路|村|镇|乡|园|苑|湖|河|浜|港|桥|交叉口|口|旁|侧|段|沿线)/;
  if (mapAddress.startsWith(city) && district && locatorPattern.test(mapAddress.slice(city.length + district.length))) return mapAddress;
  if (hint) {
    const withoutCity = hint.startsWith(city) ? hint.slice(city.length) : hint;
    const withoutDistrict = district && withoutCity.startsWith(district) ? withoutCity.slice(district.length) : withoutCity;
    return `${city}${district}${withoutDistrict}`;
  }
  return mapAddress.startsWith(city) ? mapAddress : `${city}${mapAddress}`;
}

function stableId(record) {
  if (record.city === '嘉兴市' && record.name === '桐乡植物园') return 'nature-7ca741a6196ae0e3295d5a95';
  const sourceKey = record.sourceId || `${record.name}|${canonicalAddress(record)}`;
  return `nature-${crypto.createHash('sha256').update(`${record.city}|${sourceKey}`).digest('hex').slice(0, 24)}`;
}

function photoId(placeId, url) {
  return `photo-${crypto.createHash('sha256').update(`${placeId}|${url}`).digest('hex').slice(0, 24)}`;
}

const allBefore = await prisma.place.findMany({
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  orderBy: { id: 'asc' }
});
const nonNatureHashBefore = rowsHash(allBefore.filter((place) => place.category !== '自然'));
const existingNatureById = new Map(allBefore.filter((place) => place.category === '自然').map((place) => [place.id, place]));
const managedIds = new Set(geocodedPayload.records.map((record) => stableId(record)));
const held = [];
const approved = [];

for (const record of geocodedPayload.records) {
  if (record.status !== 'approved' || !record.mapResult) {
    held.push({ city: record.city, name: record.name, stage: 'map', reason: record.status });
    continue;
  }
  if (!String(record.description || '').trim() || /^(?:无|暂无|无。|-)$/.test(String(record.description).trim())) {
    held.push({ city: record.city, name: record.name, stage: 'content', reason: 'missing_verified_description' });
    continue;
  }
  const id = stableId(record);
  const photo = approvedPhotoByName.get(record.name);
  const place = {
    id,
    name: record.name,
    category: '自然',
    address: canonicalAddress(record),
    latitude: Number(record.mapResult.latitude),
    longitude: Number(record.mapResult.longitude),
    hours: record.hours || '',
    description: String(record.description).trim(),
    pushedFingerprint: '',
    photos: photo ? [{ id: photoId(id, photo.publicUrl), url: photo.publicUrl, sortOrder: 0 }] : []
  };
  const issues = auditPlaceRecord(place);
  if (issues.length) {
    held.push({ city: record.city, name: record.name, stage: 'audit', reason: issues, address: place.address });
    continue;
  }
  approved.push({ ...place, sourceUrl: record.sourceUrl, mapResult: record.mapResult });
}

const seen = new Map();
const exactDuplicates = [];
for (const place of approved) {
  const key = `${place.name.trim().toLowerCase()}|${normalizeAddress(place.address)}`;
  if (seen.has(key)) exactDuplicates.push({ place: place.name, duplicateOf: seen.get(key) });
  else seen.set(key, place.name);
}
if (exactDuplicates.length) throw new Error(`自然候选存在 ${exactDuplicates.length} 条完全重复：${JSON.stringify(exactDuplicates)}`);

const nearbyPairs = [];
for (let left = 0; left < approved.length; left += 1) {
  for (let right = left + 1; right < approved.length; right += 1) {
    const meters = distanceMeters(approved[left], approved[right]);
    if (meters <= 40 && approved[left].name.trim() === approved[right].name.trim()) {
      nearbyPairs.push({ left: approved[left].name, right: approved[right].name, meters: Number(meters.toFixed(1)) });
    }
  }
}
if (nearbyPairs.length) throw new Error(`自然候选存在 ${nearbyPairs.length} 组 40 米内同名点位`);

const approvedIds = new Set(approved.map((place) => place.id));
const toCreate = approved.filter((place) => !existingNatureById.has(place.id));
const toUpdate = approved.filter((place) => {
  const existing = existingNatureById.get(place.id);
  if (!existing) return false;
  const scalarChanged = ['name', 'category', 'address', 'latitude', 'longitude', 'hours', 'description', 'pushedFingerprint']
    .some((field) => existing[field] !== place[field]);
  const currentPhotos = existing.photos.map(({ id, url, sortOrder }) => ({ id, url, sortOrder }));
  return scalarChanged || JSON.stringify(currentPhotos) !== JSON.stringify(place.photos);
});
const toDelete = [...existingNatureById.values()].filter((place) => managedIds.has(place.id) && !approvedIds.has(place.id));
const untrackedExisting = [...existingNatureById.values()].filter((place) => !managedIds.has(place.id));
let backupPath = '';

if (applyChanges && (toCreate.length || toUpdate.length || toDelete.length)) {
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-nature-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(databasePath, backupPath);
  await prisma.$transaction([
    ...toDelete.map((place) => prisma.place.delete({ where: { id: place.id } })),
    ...toUpdate.flatMap((place) => [
      prisma.placePhoto.deleteMany({ where: { placeId: place.id } }),
      prisma.place.update({
        where: { id: place.id },
        data: {
          name: place.name, category: place.category, address: place.address,
          latitude: place.latitude, longitude: place.longitude, hours: place.hours,
          description: place.description, pushedFingerprint: '',
          photos: { create: place.photos.map(({ id, url, sortOrder }) => ({ id, url, sortOrder })) }
        }
      })
    ]),
    ...toCreate.map((place) => prisma.place.create({
      data: {
        id: place.id, name: place.name, category: place.category, address: place.address,
        latitude: place.latitude, longitude: place.longitude, hours: place.hours,
        description: place.description, pushedFingerprint: '',
        photos: { create: place.photos.map(({ id, url, sortOrder }) => ({ id, url, sortOrder })) }
      }
    }))
  ]);
}

const allAfter = await prisma.place.findMany({
  include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  orderBy: { id: 'asc' }
});
const nonNatureHashAfter = rowsHash(allAfter.filter((place) => place.category !== '自然'));
if (nonNatureHashBefore !== nonNatureHashAfter) throw new Error('原图书馆、食堂数据哈希发生变化');

const report = {
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  sourceCount: geocodedPayload.records.length,
  approvedCount: approved.length,
  heldCount: held.length,
  photoCount: approved.reduce((count, place) => count + place.photos.length, 0),
  rejectedPhotoNames: [...rejectedPhotoNames].sort(),
  toCreate: toCreate.map((place) => place.name),
  toUpdate: toUpdate.map((place) => place.name),
  toDelete: toDelete.map((place) => place.name),
  untrackedExisting: untrackedExisting.map((place) => place.name),
  held,
  nonNatureHashBefore,
  nonNatureHashAfter,
  evidence: approved.map((place) => ({
    id: place.id,
    name: place.name,
    address: place.address,
    sourceUrl: place.sourceUrl,
    mapVerification: place.mapResult,
    photo: place.photos[0]?.url || ''
  }))
};
await fs.writeFile(
  path.join(researchDirectory, applyChanges ? 'apply-report.json' : 'preview-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify({
  applied: applyChanges,
  approved: approved.length,
  held: held.length,
  photos: report.photoCount,
  create: toCreate.length,
  update: toUpdate.length,
  delete: toDelete.length,
  untrackedExisting: untrackedExisting.length,
  backupPath
}, null, 2));
await prisma.$disconnect();
