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
const reportDirectory = path.join(projectRoot, 'data', 'research', 'all-map-poi-audit-2026-08-09');
const reportPath = path.join(reportDirectory, 'results.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const minimumWaitMs = Number(process.env.MAP_INTERVAL_MIN_MS || 220);
const maximumWaitMs = Number(process.env.MAP_INTERVAL_MAX_MS || 520);
const batchSize = Number(process.env.MAP_AUDIT_BATCH_SIZE || 0);

const places = await prisma.place.findMany({
  where: { category: { in: ['图书馆', '食堂'] } },
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
await prisma.$disconnect();
await fs.mkdir(reportDirectory, { recursive: true });

let previous = { results: [] };
try {
  previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
} catch {}
const resultById = new Map((previous.results || []).map((result) => [result.id, result]));
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
      district: extractDistrict(candidate.address)
    }))
    .filter((candidate) => nameRelated(place.name, candidate.name))
    .filter((candidate) => !district || !candidate.district || district === candidate.district)
    .filter((candidate) => candidate.movementMeters <= 600)
    .sort((left, right) => left.movementMeters - right.movementMeters)[0] || null;
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
    if (addressMatch) {
      result = {
        ...place,
        status: 'verified_address',
        candidate: addressMatch,
        query: place.address
      };
    } else {
      const poiCandidates = await mapSearch(`${place.name} ${extractDistrict(place.address)}`, place);
      const poiMatch = chooseNameCandidate(place, poiCandidates);
      if (poiMatch) {
        result = {
          ...place,
          status: 'verified_poi',
          candidate: poiMatch,
          query: `${place.name} ${extractDistrict(place.address)}`
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
