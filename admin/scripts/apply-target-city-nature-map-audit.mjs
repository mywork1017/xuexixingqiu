import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const reportRoot = path.join(root, 'data/research/nature-map-poi-audit-shanghai-suzhou-2026-09-13');
const audit = JSON.parse(await readFile(path.join(reportRoot, 'results.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function cleanAddress(value, placeName = '') {
  let text = String(value || '').replace(/^中国/, '').replace(/^江苏省(?=苏州市)/, '').replace(/\s+/g, '');
  text = text
    .replace(/\((?:近|距|从|地铁|[^)]*步行)[^)]*\)/g, '')
    .replace(/\((?:[^)]*(?:东至|西至|南至|北至|面积|毗邻)[^)]*)\)/g, '')
    .replace(/(上海市[^区]{1,12}区)上海市/g, '$1')
    .replace(/(苏州市[^区县市]{1,12}(?:区|县|市))苏州市/g, '$1')
    .replace(/附近$/, '')
    .replace(/[，,。；;]+$/, '');
  for (let index = 0; index < 8; index += 1) {
    const next = text
      .replace(/([\u4e00-\u9fff]{2,12}(?:街道|高科技园区))\1/g, '$1')
      .replace(/([\u4e00-\u9fff]{2,12}(?:街道|高科技园区))(?=.*\1)/, '');
    if (next === text) break;
    text = next;
  }
  text = text.replace(/(\d+(?:-\d+)?号).*/, '$1');
  if (placeName) text = text.replace(new RegExp(`${placeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:内|景区)?$`), '');
  return text;
}

function normalizeName(value) {
  return String(value || '').replace(/^(?:上海市?|苏州市?)/, '').replace(/[（）()·\s]/g, '').replace(/(?:北门|南门|东门|西门|入口)$/, '');
}

function candidateMatchesPlace(placeName, candidateName) {
  const place = normalizeName(placeName);
  const candidate = normalizeName(candidateName);
  if (place.length <= 3) return candidate === place;
  return candidate.includes(place) || place.includes(candidate);
}

function targetCity(address) {
  return address.startsWith('上海市') || address.startsWith('苏州市') || address.startsWith('苏州高新区');
}

function hashRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

const current = await prisma.place.findMany({ orderBy: { id: 'asc' }, include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } });
const currentById = new Map(current.map((place) => [place.id, place]));
const otherHashBefore = hashRows(current.filter((place) => !targetCity(place.address)));
const changes = [];
const held = [];

for (const result of audit.results || []) {
  const place = currentById.get(result.id);
  const candidate = result.candidate;
  if (!place || !candidate || !['verified_poi', 'verified_address'].includes(result.status)) {
    held.push({ id: result.id, name: result.name, status: result.status, reason: 'no_verified_map_poi' });
    continue;
  }
  if (!candidateMatchesPlace(place.name, candidate.name)) {
    held.push({ id: result.id, name: result.name, status: result.status, candidateName: candidate.name, candidateAddress: cleanAddress(candidate.address, place.name), reason: 'candidate_name_mismatch' });
    continue;
  }
  const address = cleanAddress(candidate.address, place.name);
  const movementMeters = Number(candidate.movementMeters || 0);
  if (!targetCity(address) || address.length > 80 || !/(路|街|巷|弄|道|镇|村|浜|堤|公路)/.test(address)) {
    held.push({ id: result.id, name: result.name, status: result.status, candidateAddress: address, reason: 'address_not_specific' });
    continue;
  }
  if (movementMeters > 3000) {
    held.push({ id: result.id, name: result.name, status: result.status, candidateAddress: address, movementMeters, reason: 'movement_over_3000m' });
    continue;
  }
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  if (address !== place.address || movementMeters >= 10) {
    changes.push({
      id: place.id,
      name: place.name,
      before: { address: place.address, latitude: place.latitude, longitude: place.longitude },
      after: { address, latitude, longitude },
      movementMeters,
      source: 'Apple 地图中国区（高德底图）',
      query: result.query
    });
  }
}

let backupPath = '';
if (apply && changes.length) {
  backupPath = path.join(root, 'data/backups/nature-map-poi-audit-2026-09-13', `dev-before-map-poi-apply-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  await prisma.$transaction(changes.map((item) => prisma.place.update({
    where: { id: item.id },
    data: { ...item.after, pushedFingerprint: '' }
  })));
}
const finalRows = apply ? await prisma.place.findMany({ orderBy: { id: 'asc' }, include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } }) : current;
const otherHashAfter = hashRows(finalRows.filter((place) => !targetCity(place.address)));
await prisma.$disconnect();
const report = { generatedAt: new Date().toISOString(), applied: apply, audited: audit.results?.length || 0, changes: changes.length, held: held.length, backupPath, otherHashBefore, otherHashAfter, otherCitiesUnchanged: otherHashBefore === otherHashAfter, records: changes, heldRecords: held };
await writeFile(path.join(reportRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, audited: report.audited, changes: changes.length, held: held.length, otherCitiesUnchanged: report.otherCitiesUnchanged, backupPath }, null, 2));
