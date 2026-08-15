import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { MAP_STYLE_CONFIG } = require('../miniprogram/config/map-style.js');
const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const outputDirectory = path.join(projectRoot, 'data', 'research', 'official-songjiang-canteens-2026-08-09');
const outputPath = path.join(outputDirectory, 'candidates.json');

const officialPlaces = [
  ['泖港镇胡光村社区长者食堂', '上海市松江区泖港镇胡光村胡光公路306号'],
  ['泗泾镇泗民HUI社区长者食堂', '上海市松江区泗泾镇泗通路225弄'],
  ['九里亭街道杜巷社区长者食堂', '上海市松江区涞坊路288弄杜巷小区331号九里亭街道综合为老服务中心'],
  ['车墩镇缘源社区长者食堂', '上海市松江区车墩镇车峰路199弄189号'],
  ['中山街道社区食堂', '上海市松江区沪松路255弄18号'],
  ['岳阳街道社区长者食堂', '上海市松江区人民北路196号'],
  ['九亭颐景园社区长者食堂', '上海市松江区涞亭南路888弄91号2楼'],
  ['新桥镇社区长者食堂', '上海市松江区新育路850号'],
  ['石湖荡镇金汇村社区长者食堂', '上海市松江区石湖荡镇金汇村金星104号'],
  ['佘山镇佘北社区长者食堂', '上海市松江区贡嘎山路300弄'],
  ['永丰社区长者食堂', '上海市松江区草场浜路125弄36号1层'],
  ['小昆山镇社区长者食堂', '上海市松江区翔昆路198号、208号'],
  ['泗泾镇迪家苑社区食堂', '上海市松江区古楼公路259弄309号'],
  ['九亭镇社区食堂', '上海市松江区文浦路150弄'],
  ['佘山镇陈坊新苑社区长者食堂', '上海市松江区外青松公路8228弄52号'],
  ['泗泾镇新凯片区社区食堂', '上海市松江区泗凯路667号'],
  ['永丰街道谷水佳苑社区长者食堂', '上海市松江区富强路1585号'],
  ['泖港镇黄桥村社区长者食堂', '上海市松江区泖港镇黄桥村1085号'],
  ['叶榭社区食堂（长者食堂）', '上海市松江区叶榭镇叶校路355弄113号101室1层'],
  ['松南城社区长者食堂', '上海市松江区车墩镇香亭路999弄1025号2层'],
  ['方松街道兰桥社区长者食堂', '上海市松江区思贤路1336、1338号2层2001室'],
  ['洞泾镇光星社区长者食堂', '上海市松江区洞宁路655弄62幢643、645、647、649号'],
  ['方松街道通波社区长者食堂', '上海市松江区通波路50号1幢C区'],
  ['方松街道西部社区长者食堂', '上海市松江区新松江路2661号']
].map(([name, address]) => ({ name, address, category: '食堂' }));

function normalize(value) {
  return String(value || '')
    .replace(/上海市?|松江区|社区|街道|乡|镇|长者|老年|食堂|助餐(?:点|服务)?/g, '')
    .replace(/[（）()，,。.、:：;；/\\_\-—\s]/g, '')
    .toLowerCase();
}

function geocodeAddress(address) {
  return address
    .replace(/、\d+号/g, '')
    .replace(/(\d+)、\d+(号)/, '$1$2')
    .replace(/(\d+幢\d+)、\d+、\d+、\d+号/, '$1号')
    .replace(/\d+室.*$/, '')
    .replace(/\d+层.*$/, '');
}

async function geocode(place) {
  const endpoint = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
  endpoint.searchParams.set('address', geocodeAddress(place.address));
  endpoint.searchParams.set('key', MAP_STYLE_CONFIG.subkey);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`腾讯地图请求失败：${response.status}`);
  const payload = await response.json();
  if (Number(payload.status) !== 0 || !payload.result?.location) {
    throw new Error(`腾讯地图定位失败：${payload.message || payload.status}`);
  }
  const { lat, lng } = payload.result.location;
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    reliability: Number(payload.result.reliability) || 0,
    level: String(payload.result.level || ''),
    title: String(payload.result.title || ''),
    geocodedAddress: geocodeAddress(place.address)
  };
}

const { stdout } = await execFileAsync('sqlite3', [
  '-readonly',
  '-json',
  path.join(projectRoot, 'admin', 'prisma', 'dev.db'),
  "SELECT id,name,address,latitude,longitude FROM Place WHERE category='食堂'"
]);
const existing = JSON.parse(stdout);
const candidates = [];
for (const place of officialPlaces) {
  const duplicate = existing.find((item) => {
    const left = normalize(item.name);
    const right = normalize(place.name);
    return left && right && (left === right || left.includes(right) || right.includes(left));
  });
  if (duplicate) {
    candidates.push({ ...place, status: 'duplicate', duplicate });
    continue;
  }
  try {
    const point = await geocode(place);
    const validPoint = point.latitude >= 30.8
      && point.latitude <= 31.3
      && point.longitude >= 120.8
      && point.longitude <= 121.5;
    const accepted = validPoint && point.reliability >= 7;
    candidates.push({ ...place, ...point, status: accepted ? 'approved' : 'review' });
  } catch (error) {
    candidates.push({
      ...place,
      status: 'review',
      error: error instanceof Error ? error.message : String(error)
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: '上海市松江区综合为老服务平台（松江区民政局）',
  sourceUrls: [
    'https://yljg.songjiang.gov.cn/index.php?page=1&r=map%2Flist&vendor_sub_type=2&vendor_type=4',
    'https://yljg.songjiang.gov.cn/index.php?page=2&r=map%2Flist&vendor_type=4'
  ],
  phonePolicy: '未采集、未保存电话',
  total: candidates.length,
  approved: candidates.filter((item) => item.status === 'approved').length,
  review: candidates.filter((item) => item.status === 'review').length,
  duplicates: candidates.filter((item) => item.status === 'duplicate').length,
  candidates
}, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);
