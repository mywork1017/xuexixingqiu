import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  distanceMeters,
  extractDistrict,
  extractRoadNumber,
  normalizeAddress,
  normalizeName,
  scoreMapCandidate
} from '../../scripts/lib/place-data-quality.mjs';

process.env.DATABASE_URL ||= 'file:./dev.db';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const projectRoot = path.resolve(import.meta.dirname, '../..');
const reportDirectory = path.resolve(projectRoot, process.env.MAP_AUDIT_REPORT_DIR || 'data/research/all-map-poi-audit-2026-08-09');
const reportPath = path.join(reportDirectory, 'results.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const minimumWaitMs = Number(process.env.MAP_INTERVAL_MIN_MS || 220);
const maximumWaitMs = Number(process.env.MAP_INTERVAL_MAX_MS || 520);
const batchSize = Number(process.env.MAP_AUDIT_BATCH_SIZE || 0);
const cityPrefixes = (process.env.MAP_AUDIT_CITY_PREFIXES || '').split(',').map((item) => item.trim()).filter(Boolean);
const categories = (process.env.MAP_AUDIT_CATEGORIES || '').split(',').map((item) => item.trim()).filter(Boolean);
const forceRefresh = process.env.MAP_AUDIT_FORCE_REFRESH === '1';
const preferPoi = process.env.MAP_AUDIT_PREFER_POI === '1';
const poiMaxMovementMeters = Number(process.env.MAP_AUDIT_POI_MAX_MOVEMENT || 600);
const shardCount = Math.max(1, Number(process.env.MAP_AUDIT_SHARD_COUNT || 1));
const shardIndex = Number(process.env.MAP_AUDIT_SHARD_INDEX || 0);

const allPlaces = await prisma.place.findMany({
  where: {
    category: { in: categories.length ? categories : ['图书馆', '食堂', '自然'] },
    ...(cityPrefixes.length ? { OR: cityPrefixes.map((prefix) => ({ address: { startsWith: prefix } })) } : {})
  },
  orderBy: { id: 'asc' },
  select: {
    id: true,
    name: true,
    category: true,
    address: true,
    latitude: true,
    longitude: true,
    hours: true,
    description: true,
    photos: { select: { id: true } }
  }
});
const places = allPlaces.filter((_, index) => index % shardCount === shardIndex);
await prisma.$disconnect();
await fs.mkdir(reportDirectory, { recursive: true });

let previous = { results: [] };
try {
  previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
} catch {}
const resultById = new Map(forceRefresh ? [] : (previous.results || []).map((result) => [result.id, result]));
const remaining = places.filter((place) => !resultById.has(place.id));
const queue = batchSize > 0 ? remaining.slice(0, batchSize) : remaining;

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('https://maps.apple.com.cn/search?query=x&center=31.23,121.47&span=1,1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

async function mapSearch(query, place) {
  return page.evaluate(async ({ query: value, latitude, longitude }) => {
    const search = new mapkit.Search({
      language: 'zh-CN',
      region: new mapkit.CoordinateRegion(
        new mapkit.Coordinate(latitude, longitude),
        new mapkit.CoordinateSpan(0.35, 0.35)
      )
    });
    return new Promise((resolve, reject) => search.search(value, (error, data) => {
      if (error) reject(new Error(String(error)));
      else resolve(data.places.slice(0, 12).map((candidate) => ({
        name: candidate.name || '',
        address: candidate.formattedAddress || candidate.name || '',
        latitude: candidate.coordinate.latitude,
        longitude: candidate.coordinate.longitude
      })));
    }));
  }, { query, latitude: place.latitude, longitude: place.longitude });
}

function nameRelated(first, second) {
  const left = normalizeName(first);
  const right = normalizeName(second);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

const subordinatePoiPattern = /(停车场|停车点|管理中心|生活区|办公区|公厕|卫生间|洗手间|出入口|入口|售票处|游客中心|码头|公交站|地铁站|充电站|服务中心|警务室|驿站|商店|餐厅|咖啡)/;

function safeNameRelation(placeName, candidateName) {
  const place = normalizeName(placeName);
  const candidate = normalizeName(candidateName);
  if (!place || !candidate || subordinatePoiPattern.test(candidateName)) return 0;
  if (place === candidate) return 2;
  return place.length >= 4 && candidate.length >= 4 && (place.includes(candidate) || candidate.includes(place)) ? 1 : 0;
}

function chooseAddressCandidate(place, candidates) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      evidence: scoreMapCandidate(place, candidate),
      movementMeters: Math.round(distanceMeters(place, candidate))
    }))
    .filter((candidate) => candidate.evidence.accepted)
    .sort((left, right) => (
      right.evidence.score - left.evidence.score
      || left.movementMeters - right.movementMeters
    ))[0] || null;
}

function chooseNameCandidate(place, candidates) {
  const district = extractDistrict(place.address);
  return candidates
    .map((candidate) => ({
      ...candidate,
      movementMeters: Math.round(distanceMeters(place, candidate)),
      district: extractDistrict(candidate.address),
      nameRelation: safeNameRelation(place.name, candidate.name)
    }))
    .filter((candidate) => candidate.nameRelation > 0)
    .filter((candidate) => !district || !candidate.district || district === candidate.district)
    .filter((candidate) => candidate.movementMeters <= poiMaxMovementMeters)
    .sort((left, right) => right.nameRelation - left.nameRelation || left.movementMeters - right.movementMeters)[0] || null;
}

async function saveReport() {
  const results = places.map((place) => resultById.get(place.id)).filter(Boolean);
  const counts = results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, {});
  await fs.writeFile(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Apple 地图中国区（高德底图）',
    totalPlaces: places.length,
    completed: results.length,
    remaining: places.length - results.length,
    counts,
    results
  }, null, 2)}\n`);
}

for (let index = 0; index < queue.length; index += 1) {
  const place = queue[index];
  let result;
  try {
    const addressCandidates = await mapSearch(place.address, place);
    const addressMatch = chooseAddressCandidate(place, addressCandidates);
    const poiQuery = `${place.name} ${extractDistrict(place.address)}`;
    const poiCandidates = await mapSearch(poiQuery, place);
    const poiMatch = chooseNameCandidate(place, poiCandidates);
    if (preferPoi && poiMatch) {
      result = {
        ...place,
        status: 'verified_poi',
        candidate: poiMatch,
        query: poiQuery,
        addressCandidates,
        poiCandidates
      };
    } else if (addressMatch) {
      result = {
        ...place,
        status: 'verified_address',
        candidate: addressMatch,
        query: place.address,
        addressCandidates,
        poiCandidates
      };
    } else {
      if (poiMatch) {
        result = {
          ...place,
          status: 'verified_poi',
          candidate: poiMatch,
          query: poiQuery,
          addressCandidates,
          poiCandidates
        };
      } else if (!extractRoadNumber(place.address)) {
        const nearbyMatch = addressCandidates
          .map((candidate) => ({ ...candidate, movementMeters: Math.round(distanceMeters(place, candidate)) }))
          .find((candidate) => nameRelated(place.name, candidate.name) && candidate.movementMeters <= 120);
        result = nearbyMatch
          ? { ...place, status: 'verified_poi', candidate: nearbyMatch, query: place.address }
          : { ...place, status: 'unverified', addressCandidates, poiCandidates };
      } else {
        result = { ...place, status: 'unverified', addressCandidates, poiCandidates };
      }
    }
  } catch (error) {
    result = { ...place, status: 'error', error: String(error?.message || error) };
  }
  resultById.set(place.id, result);
  const completed = resultById.size;
  process.stdout.write(`${completed}/${places.length} ${result.status} ${place.category} ${place.name}\n`);
  if ((index + 1) % 10 === 0) await saveReport();
  const waitMs = minimumWaitMs + Math.random() * Math.max(0, maximumWaitMs - minimumWaitMs);
  await page.waitForTimeout(waitMs);
}

await saveReport();
await browser.close();
process.stdout.write(`${reportPath}\n`);
