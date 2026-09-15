#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.DATABASE_URL ||= `file:${path.join(root, 'admin', 'prisma', 'dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const { auditPlaceRecord, distanceMeters, normalizeName } = await import('../../scripts/lib/place-data-quality.mjs');
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const researchRoot = path.join(root, 'data', 'research', 'nature-expansion-2026-09-13');
const payload = JSON.parse(await fs.readFile(path.join(researchRoot, 'curated-map-places.json'), 'utf8'));
const existing = await prisma.place.findMany({ where: { category: '自然' } });
const approved = [];
const held = [];
const seenNames = new Set(existing.map((place) => normalizeName(place.name)));

function stableId(record) {
  return `nature-map-${crypto.createHash('sha256').update(`${record.city}|${record.sourceId}`).digest('hex').slice(0, 24)}`;
}

function canonicalAddress(record) {
  return String(record.addressHint || '')
    .replace(/^中国/, '')
    .replace(/^(?:江苏省|浙江省)/, '')
    .trim();
}

for (const record of payload.selected) {
  const normalizedName = normalizeName(record.name);
  if (seenNames.has(normalizedName)) {
    held.push({ name: record.name, city: record.city, reason: 'duplicate_name' });
    continue;
  }
  const place = {
    id: stableId(record), name: record.name, category: '自然', address: canonicalAddress(record),
    latitude: Number(record.mapResult.latitude), longitude: Number(record.mapResult.longitude),
    hours: '', description: String(record.description || '').trim(), pushedFingerprint: ''
  };
  const nearbyDuplicate = existing.find((candidate) => distanceMeters(candidate, place) < 40 && normalizeName(candidate.name) === normalizedName);
  const issues = auditPlaceRecord(place);
  if (nearbyDuplicate || issues.length) {
    held.push({ name: record.name, city: record.city, reason: nearbyDuplicate ? 'nearby_duplicate' : issues, address: place.address });
    continue;
  }
  seenNames.add(normalizedName);
  approved.push(place);
}

const existingIds = new Set(existing.map((place) => place.id));
const toCreate = approved.filter((place) => !existingIds.has(place.id));
let backupPath = '';
if (apply && toCreate.length) {
  const backupRoot = path.join(root, 'data', 'backups', 'nature-expansion-2026-09-13');
  await fs.mkdir(backupRoot, { recursive: true });
  backupPath = path.join(backupRoot, `dev-before-nature-expansion-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(root, 'admin', 'prisma', 'dev.db'), backupPath);
  for (let offset = 0; offset < toCreate.length; offset += 100) {
    await prisma.$transaction(toCreate.slice(offset, offset + 100).map((place) => prisma.place.create({ data: place })));
  }
}
const result = {
  generatedAt: new Date().toISOString(), applied: apply, selected: payload.selected.length,
  approved: approved.length, held: held.length, create: toCreate.length, backupPath,
  counts: Object.fromEntries([...new Set(approved.map((item) => item.address.match(/^(.*?市)/)?.[1] || ''))]
    .map((city) => [city, approved.filter((item) => item.address.startsWith(city)).length])), heldRecords: held
};
await fs.writeFile(path.join(researchRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
