import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const root = path.resolve(import.meta.dirname, '../..');
const outputPath = path.join(root, 'data/research/nature-map-poi-audit-shanghai-suzhou-2026-09-13/reverse-geocode.json');
const places = await prisma.place.findMany({ where: { category: '自然', OR: [{ address: { startsWith: '上海市' } }, { address: { startsWith: '苏州市' } }, { address: { startsWith: '苏州高新区' } }] }, orderBy: { id: 'asc' } });
await prisma.$disconnect();
const problematic = places.filter((place) => /(面积|毗邻|核心地区|东至|西至|南至|北至|位于)/.test(place.address) || !/(路|街|巷|弄|道|镇|村|浜|堤|公路)/.test(place.address));

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('https://maps.apple.com.cn/search?query=x&center=31.23,121.47&span=1,1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const records = [];
for (const [index, place] of problematic.entries()) {
  const candidates = await page.evaluate(async ({ latitude, longitude }) => {
    const geocoder = new mapkit.Geocoder({ language: 'zh-CN' });
    return new Promise((resolve, reject) => geocoder.reverseLookup(new mapkit.Coordinate(latitude, longitude), (error, data) => {
      if (error) reject(new Error(String(error)));
      else resolve((data.results || []).map((item) => ({
        name: item.name || '',
        address: item.formattedAddress || '',
        latitude: item.coordinate?.latitude,
        longitude: item.coordinate?.longitude
      })));
    }));
  }, { latitude: place.latitude, longitude: place.longitude });
  records.push({ id: place.id, name: place.name, currentAddress: place.address, latitude: place.latitude, longitude: place.longitude, candidates });
  process.stdout.write(`${index + 1}/${problematic.length} ${place.name}\n`);
  await page.waitForTimeout(80);
}
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
await browser.close();
process.stdout.write(`${outputPath}\n`);
