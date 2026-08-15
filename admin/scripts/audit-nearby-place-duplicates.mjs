import fs from 'node:fs/promises';
import path from 'node:path';
import {
  distanceMeters,
  extractRoadNumber,
  normalizeAddress,
  normalizeName
} from '../../scripts/lib/place-data-quality.mjs';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const projectRoot = path.resolve(import.meta.dirname, '../..');
const reportPath = path.join(projectRoot, 'data', 'research', 'nearby-place-duplicates-2026-08-09.json');
const reviewedDistinctPairs = new Map([
  [
    ['cmsl5pfh8000210qsyro4t04j', 'place_1q59z9z'].sort().join('|'),
    '门牌分别为共和新路2205弄与2299号，地图存在两个独立社区食堂POI'
  ],
  [
    ['place_143v44e', 'place_1qkfgdm'].sort().join('|'),
    '明复图书馆与瑞金二路街道图书馆门牌、机构层级均不同'
  ],
  [
    ['place_58p9oc', 'place_m2dseq'].sort().join('|'),
    '石门二路街道图书馆与静安区少年儿童图书馆门牌、服务对象均不同'
  ]
]);
const places = await prisma.place.findMany({
  include: { photos: { select: { id: true } } },
  orderBy: { id: 'asc' }
});

const completeness = (place) => (
  (place.address ? Math.min(place.address.length, 35) : 0)
  + (place.hours ? 12 : 0)
  + (place.description ? 12 : 0)
  + Math.min(place.photos.length * 5, 20)
);
const nameRelated = (first, second) => {
  const left = normalizeName(first);
  const right = normalizeName(second);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
};

const pairs = [];
for (let left = 0; left < places.length; left += 1) {
  for (let right = left + 1; right < places.length; right += 1) {
    const first = places[left];
    const second = places[right];
    if (first.category !== second.category) continue;
    const distance = distanceMeters(first, second);
    if (distance > 60) continue;
    const firstRoadNumber = extractRoadNumber(first.address);
    const secondRoadNumber = extractRoadNumber(second.address);
    const sameRoadNumber = Boolean(firstRoadNumber && firstRoadNumber === secondRoadNumber);
    const sameAddress = normalizeAddress(first.address) === normalizeAddress(second.address);
    const relatedName = nameRelated(first.name, second.name);
    const reviewReason = reviewedDistinctPairs.get([first.id, second.id].sort().join('|')) || '';
    const likelyDuplicate = !reviewReason && (sameAddress || (sameRoadNumber && distance <= 45) || (relatedName && distance <= 60));
    pairs.push({
      distanceMeters: Math.round(distance),
      likelyDuplicate,
      reviewStatus: reviewReason ? 'verified_distinct' : (likelyDuplicate ? 'unresolved' : 'different'),
      reviewReason,
      evidence: { sameAddress, sameRoadNumber, relatedName },
      first: {
        id: first.id,
        name: first.name,
        address: first.address,
        completeness: completeness(first),
        hours: first.hours,
        descriptionLength: first.description.length,
        photos: first.photos.length
      },
      second: {
        id: second.id,
        name: second.name,
        address: second.address,
        completeness: completeness(second),
        hours: second.hours,
        descriptionLength: second.description.length,
        photos: second.photos.length
      }
    });
  }
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  rows: places.length,
  radiusMeters: 60,
  pairs: pairs.length,
  likelyDuplicates: pairs.filter((pair) => pair.likelyDuplicate).length,
  results: pairs.sort((left, right) => left.distanceMeters - right.distanceMeters)
}, null, 2)}\n`);
process.stdout.write(`60米内同类地点 ${pairs.length} 对，疑似重复 ${pairs.filter((pair) => pair.likelyDuplicate).length} 对\n${reportPath}\n`);
await prisma.$disconnect();
