import fs from 'node:fs/promises';
import path from 'node:path';
import {
  auditPlaceRecord,
  normalizeAddress,
  normalizeName
} from '../../scripts/lib/place-data-quality.mjs';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const places = await prisma.place.findMany({ orderBy: { name: 'asc' } });
const findings = places.flatMap((place) => (
  auditPlaceRecord(place).map((issue) => ({
    issue,
    name: place.name,
    category: place.category,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude
  }))
));
const seen = new Map();

for (const place of places) {
  const key = `${place.category}|${normalizeName(place.name)}|${normalizeAddress(place.address)}`;
  if (seen.has(key)) {
    findings.push({
      issue: 'duplicate_place',
      name: place.name,
      category: place.category,
      address: place.address,
      duplicateOf: seen.get(key)
    });
  } else {
    seen.set(key, place.name);
  }
}

const counts = findings.reduce((result, finding) => {
  result[finding.issue] = (result[finding.issue] || 0) + 1;
  return result;
}, {});
const categoryCounts = places.reduce((result, place) => {
  result[place.category] = (result[place.category] || 0) + 1;
  return result;
}, {});
const report = {
  generatedAt: new Date().toISOString(),
  places: places.length,
  findings: findings.length,
  counts,
  categoryCounts,
  samples: findings.slice(0, 100)
};
const reportPath = path.resolve(process.cwd(), '..', 'data', 'place-data-quality-report.json');

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await prisma.$disconnect();
console.log(JSON.stringify(report, null, 2));
