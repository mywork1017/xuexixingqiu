import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { distanceMeters, extractDistrict } from '../../scripts/lib/place-data-quality.mjs';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const auditRoot = path.join(root, 'data/research/nature-map-poi-audit-all-cities-2026-09-14-v2');
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const shardFiles = [0, 1, 2].map((index) => path.join(auditRoot, `shard-${index}/results.json`));
const audits = await Promise.all(shardFiles.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
const results = audits.flatMap((audit) => audit.results || []);
const places = await prisma.place.findMany({ where: { category: '自然' }, orderBy: { id: 'asc' } });
const placeById = new Map(places.map((place) => [place.id, place]));

const descriptionPattern = /(毗邻|地处|位于|核心地区|东至|西至|南至|北至|用地面积|占地面积|沿线|区域内)/;
const locationPattern = /(路|街|巷|弄|道|公路|大道|镇|乡|村|浜|堤|岛|景区|园区|交叉口|交汇处|路口)/;

function cleanAddress(value) {
  let text = String(value || '').trim().replace(/^中国/, '').replace(/^(?:江苏省|浙江省)(?=(?:苏州市|无锡市|南通市|镇江市|嘉兴市))/, '');
  text = text.replace(/\s+/g, '').replace(/(?<!^)上海市/g, '').replace(/(?<!^)苏州市/g, '');
  for (let index = 0; index < 8; index += 1) {
    const next = text
      .replace(/([\u4e00-\u9fff]{2,8}街道)(?:\1)+/g, '$1')
      .replace(/([\u4e00-\u9fff]{1,8}区)(?:\1)+/g, '$1')
      .replace(/([\u4e00-\u9fff]{1,8}镇)(?:\1)+/g, '$1')
      .replace(/([\u4e00-\u9fff]{1,8}乡)(?:\1)+/g, '$1');
    if (next === text) break;
    text = next;
  }
  text = text
    .replace(/\((?:[^)]*(?:地铁站|步行|建设中|装修中)[^)]*)\)/g, '')
    .replace(/[，,。；;]+$/g, '');
  const lastNumber = text.lastIndexOf('号');
  if (lastNumber >= 0) {
    const suffix = text.slice(lastNumber + 1);
    if (/(公园|景区|绿地|休闲苑|图书馆|酒店|大厦|学校|地铁站|内|楼|栋|室|[东西南北]侧|方向|靠近)/.test(suffix)) {
      text = text.slice(0, lastNumber + 1);
    }
  }
  return text;
}

function addressIssues(address) {
  const issues = [];
  if (!/^(上海市|苏州市|嘉兴市|南通市|无锡市|镇江市)/.test(address)) issues.push('missing_city');
  if (!extractDistrict(address)) issues.push('missing_district');
  if (!locationPattern.test(address)) issues.push('missing_location_detail');
  if (descriptionPattern.test(address)) issues.push('description_text');
  if (address.length > 80) issues.push('too_long');
  if (/([\u4e00-\u9fff]{2,8}街道)(?:.*\1)/.test(address)) issues.push('repeated_street');
  if (/区区|市市|县县/.test(address)) issues.push('repeated_division_suffix');
  return issues;
}

function addressScore(address) {
  let score = 0;
  if (/^(上海市|苏州市|嘉兴市|南通市|无锡市|镇江市)/.test(address)) score += 2;
  if (extractDistrict(address)) score += 2;
  if (locationPattern.test(address)) score += 2;
  if (/\d+(?:[—–-]\d+)?号/.test(address)) score += 8;
  if (/(交叉口|交汇处|路口|交界处)/.test(address)) score += 5;
  if (/[东西南北](?:侧|角|约|\d)/.test(address)) score += 2;
  score -= addressIssues(address).length * 8;
  return score;
}

const manual = new Map([
  ['nature-b345224edae5fe79d49657d6', {
    address: '上海市浦东新区世博大道2200号',
    latitude: 31.183669,
    longitude: 121.47437,
    source: 'Apple地图中国区“世博文化公园(北门)”POI'
  }],
  ['nature-0ebf7074ba705260525f5993', {
    address: '上海市奉贤区运河路与环城东路交叉口西侧', latitude: 30.922748, longitude: 121.471966,
    source: '携程地址与奉贤区道路信息交叉核验'
  }],
  ['nature-3c781c43071c51ec1f3ab808', {
    address: '南通市如皋市城东路与汪平路交叉口南侧', latitude: 32.315802, longitude: 120.66555,
    source: '如皋市公开项目范围与地图岸线核验'
  }],
  ['nature-7a78c08d8b3bf2cb55fa4ea0', {
    address: '无锡市宜兴市茶东新村583号东侧', latitude: 31.359154, longitude: 119.8261,
    source: '无锡市开放共享绿地名录与地图岸线核验'
  }],
  ['nature-9fe421d493c7d07e2efb6a65', {
    address: '无锡市惠山区洛社镇洛社大桥北侧滨河步道', latitude: 31.65045, longitude: 120.190372,
    source: '无锡市项目范围与Apple地图洛社大桥POI核验'
  }],
  ['nature-a689b90ea7deb864b0ec1bf3', {
    address: '南通市如皋市海阳南路与惠政路交叉口北侧', latitude: 32.382646, longitude: 120.575822,
    source: '如皋市龙游河工程范围与高德地图地址核验'
  }],
  ['nature-cd38ca3c484b5bd2a47e79a6', {
    address: '南通市崇川区运河北岸路南侧（崇川大桥至通扬运河段）', latitude: 32.039073, longitude: 120.879287,
    source: '南通市开放共享绿地名录与地图岸线核验'
  }],
  ['nature-map-8bba091a7826141e59929031', {
    address: '无锡市江阴市石山路68号北侧', latitude: 31.928353, longitude: 120.350939,
    source: '江阴市规划资料与地图道路核验'
  }],
  ['nature-map-aca9322b15e6c1ced3f47b42', {
    address: '南通市海安市海陵路与中坝中路交叉口西120米', latitude: 32.541765, longitude: 120.458009,
    source: 'Apple地图中国区公园入口POI'
  }],
  ['nature-map-bc4a22bfcf3bcdbf43f1da3c', {
    address: '嘉兴市南湖区城东路1487号西侧', latitude: 30.780635, longitude: 120.777445,
    source: '高德地图相邻门牌与地图绿地范围核验'
  }],
  ['nature-2851bde24c56c317a23de597', {
    address: '南通市通州区湘江北路与希望路交叉口东北侧', latitude: 32.075632, longitude: 121.093116,
    source: 'Apple地图中国区道路与公园范围核验'
  }],
  ['nature-c55fcdb6064deb5365a70b19', {
    address: '无锡市江阴市澄西路与浮桥路交叉口东40米', latitude: 31.912919, longitude: 120.246782,
    source: 'Apple地图中国区绿地入口POI'
  }],
  ['nature-fd2c720c74d5bfc9fdaf4cdb', {
    address: '南通市通州区江海大道与盛江路交叉口南140米', latitude: 32.047124, longitude: 121.076103,
    source: 'Apple地图中国区绿廊入口POI'
  }],
  ['nature-map-18056c711c0213908bffeab8', {
    address: '南通市崇川区朝阳路10号', latitude: 31.968475, longitude: 120.938325,
    source: '南通市官方资料与Apple地图地址核验'
  }],
  ['nature-map-417d312c493bcda1d7928616', {
    address: '南通市通州区朝霞路88号通州区政府西侧', latitude: 32.067663, longitude: 121.068658,
    source: '通州区官方项目位置与地图门牌核验'
  }],
  ['nature-ac6d760eb98d0a9e633f4f2c', {
    address: '无锡市江阴市城东街道东横河两岸', latitude: 31.927822, longitude: 120.292194,
    source: '江阴市绿地系统规划与开放共享绿地名录'
  }],
  ['nature-map-318b8233edd053d1fa136948', {
    address: '嘉兴市海宁市文苑路与庙桥港交叉口西侧', latitude: 30.544485, longitude: 120.679465,
    source: '海宁市项目位置与地图道路核验'
  }],
  ['nature-map-625895283762056d024eda3f', {
    address: '南通市通州区康富路金乐小学北侧', latitude: 32.039267, longitude: 121.080346,
    source: '高德地图金沙湾景区POI与南通市道路公告核验'
  }],
  ['nature-map-c75e3924e56cbebc5da2ae9f', {
    address: '南通市崇川区滨江路沿江景观台北侧', latitude: 31.80159, longitude: 120.986154,
    source: 'Apple地图中国区道路与湿地范围核验'
  }],
  ['nature-map-f63468dfcb011e6b81ecbba9', {
    address: '南通市如东县钟山路与湘江路交叉口北140米', latitude: 32.33942, longitude: 121.181055,
    source: 'Apple地图中国区公园入口POI'
  }],
  ['nature-map-01d80947a0c90599b10ff23c', {
    address: '南通市海安市红光路紫石花苑14幢东侧', latitude: 32.554554, longitude: 120.477776,
    source: 'Apple地图中国区同名POI与相邻门牌核验'
  }],
  ['nature-map-023bf5b34cb02185ec3b7b7f', {
    address: '镇江市丹阳市南二环大桥北侧', latitude: 31.977062, longitude: 119.595996,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-617921cb2689a1194545ae8f', {
    address: '南通市如皋市华实路与环西路交叉口东北161米', latitude: 32.144009, longitude: 120.679922,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-69319af6774ca67bf3713536', {
    address: '上海市青浦区环城东路侨鑫公寓北侧', latitude: 31.144375, longitude: 121.114393,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-74f88ba1150ec680a749ce96', {
    address: '上海市奉贤区百通路与望园南路交叉口东南侧', latitude: 30.914479, longitude: 121.490765,
    source: 'Apple地图中国区同名POI'
  }],
  ['nature-map-0ef0e2b62afc52c7f86cf890', {
    address: '苏州市常熟市新世纪大道与黄浦路交叉口东南侧', latitude: 31.686161, longitude: 120.77411,
    source: 'Apple地图中国区同名POI'
  }],
  ['nature-map-546481d1f2c3fc260bccbca7', {
    address: '嘉兴市桐乡市滨河大道景江花苑西侧', latitude: 30.677671, longitude: 120.621473,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-280ebd7b99b0398bc6d6286a', {
    address: '南通市崇川区崇川路江宁路段', latitude: 31.975859, longitude: 120.895716,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-dcbf1ee186a606862babeb42', {
    address: '无锡市江阴市海港大道东侧', latitude: 31.791337, longitude: 120.200011,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-6496477de9f795f81c84bdcf', {
    address: '嘉兴市嘉善县新景南路景江花苑东南270米', latitude: 30.905319, longitude: 120.958801,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-82cdb821312239f1d0e1e0ab', {
    address: '镇江市句容市243省道东侧', latitude: 31.854665, longitude: 119.103538,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-a24fbb95165b3f7c8338998a', {
    address: '无锡市江阴市须毛路东侧', latitude: 31.77136, longitude: 120.353401,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-8157c151a6b64701aa419a73', {
    address: '无锡市宜兴市芳桥镇岱华西路培源实验小学南180米', latitude: 31.410447, longitude: 119.935404,
    source: 'Apple地图中国区同名POI与道路核验'
  }],
  ['nature-map-33f12e2d6f88a03b49bc6f00', {
    address: '镇江市丹徒区香山大道26号', latitude: 32.162609, longitude: 119.311122,
    source: 'Apple地图中国区同名POI与门牌核验'
  }],
  ['nature-b8345e9d58412fdb0c6ab10c', {
    address: '上海市青浦区华青南路100号', latitude: 31.141734, longitude: 121.136354,
    source: '现有门牌地址行政区字段去重'
  }]
]);

const changes = [];
const held = [];
for (const result of results) {
  const place = placeById.get(result.id);
  if (!place) continue;
  const currentAddress = cleanAddress(place.address);
  const currentIssues = addressIssues(currentAddress);
  let next = { address: currentAddress, latitude: place.latitude, longitude: place.longitude };
  let source = currentAddress === place.address ? '' : '现有地址结构清洗';
  const override = manual.get(place.id);
  if (override) {
    next = { address: override.address, latitude: override.latitude, longitude: override.longitude };
    source = override.source;
  } else if (result.candidate) {
    const candidateAddress = cleanAddress(result.candidate.address);
    const candidateDistrict = extractDistrict(candidateAddress);
    const districtMatches = !extractDistrict(currentAddress) || !candidateDistrict || extractDistrict(currentAddress) === candidateDistrict;
    const exactPoi = result.status === 'verified_poi' && result.candidate.nameRelation === 2;
    const verifiedAddress = result.status === 'verified_address' && result.candidate.evidence?.accepted;
    const movement = Number(result.candidate.movementMeters || distanceMeters(place, result.candidate));
    if (districtMatches && (exactPoi || verifiedAddress)) {
      if (addressIssues(candidateAddress).length === 0 && (addressScore(candidateAddress) > addressScore(currentAddress) || currentIssues.length)) {
        next.address = candidateAddress;
        source = exactPoi ? 'Apple地图中国区同名POI' : 'Apple地图中国区地址匹配';
      }
      const movementLimit = exactPoi ? 1500 : 500;
      if (movement >= 10 && movement <= movementLimit) {
        next.latitude = Number(result.candidate.latitude);
        next.longitude = Number(result.candidate.longitude);
        source = exactPoi ? 'Apple地图中国区同名POI' : 'Apple地图中国区地址匹配';
      }
    }
  }
  const afterIssues = addressIssues(next.address);
  if (afterIssues.length) held.push({ id: place.id, name: place.name, address: next.address, issues: afterIssues, status: result.status });
  const before = { address: place.address, latitude: place.latitude, longitude: place.longitude };
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    changes.push({ id: place.id, name: place.name, before, after: next, movementMeters: Math.round(distanceMeters(place, next)), source });
  }
}

let backupPath = '';
if (apply && changes.length) {
  const backupDir = path.join(root, 'data/backups/nature-map-address-audit-2026-09-14');
  await mkdir(backupDir, { recursive: true });
  backupPath = path.join(backupDir, `dev-before-natural-map-address-audit-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  await prisma.$transaction(changes.map((change) => prisma.place.update({
    where: { id: change.id },
    data: { ...change.after, pushedFingerprint: '' }
  })));
}
await prisma.$disconnect();

const report = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  audited: results.length,
  changes: changes.length,
  held: held.length,
  backupPath,
  records: changes,
  heldRecords: held
};
await writeFile(path.join(auditRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, audited: results.length, changes: changes.length, held: held.length, backupPath }, null, 2));
