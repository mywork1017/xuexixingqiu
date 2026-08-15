import fs from 'node:fs/promises';
import path from 'node:path';
import { distanceMeters } from '../../scripts/lib/place-data-quality.mjs';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(import.meta.dirname, '../..');
const auditPath = path.join(projectRoot, 'data', 'research', 'all-map-poi-audit-2026-08-09', 'results.json');
const reportPath = path.join(projectRoot, 'data', 'research', 'all-map-poi-audit-2026-08-09', 'apply-result.json');
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
const current = await prisma.place.findMany({ select: { id: true, name: true, address: true, latitude: true, longitude: true } });
const currentById = new Map(current.map((place) => [place.id, place]));
const manualOverrides = new Map([
  ['cmsl3yuq70007xgo0hrpcok7i', { status: 'verified_manual', note: '同址地图POI为“金汇野鸡窠助餐中心”，保留现有点位' }],
  ['cmsl3yuq7000gxgo0epupyqxw', { status: 'verified_manual', note: '同址地图POI为“方松社区食堂（兰桥店）”，保留现有点位' }],
  ['cmsl5cboq000tm7nii4248zjo', { status: 'verified_manual', note: '官方名单与殷行一村甲74号地图楼栋同址，保留现有点位' }],
  ['place_170nw4s', { status: 'verified_manual', latitude: 31.250402, longitude: 121.426849, note: '镇坪路赵家宅25号门牌定位' }],
  ['place_4qw93f', { status: 'verified_manual', latitude: 31.243986, longitude: 121.42521, note: '中山北路2400弄小区定位' }],
  ['place_o09wfq', { status: 'verified_manual', address: '上海市崇明区向化镇陈彷公路4927号', latitude: 31.525867, longitude: 121.717708, note: '地图门牌纠正“陈仿”为“陈彷”' }],
  ['place_ry9mpm', { status: 'verified_manual', latitude: 31.237037, longitude: 121.486119, note: '政府名单及九江路210号门牌复核' }]
]);

const operations = [];
const verified = [];
const rejected = [];
for (const result of audit.results || []) {
  const place = currentById.get(result.id);
  if (!place) continue;
  const manual = manualOverrides.get(result.id);
  const candidate = manual || result.candidate;
  const accepted = manual || ['verified_address', 'verified_poi'].includes(result.status);
  if (!accepted || !candidate) {
    rejected.push({ id: place.id, name: place.name, address: place.address, reason: result.status });
    continue;
  }
  const point = {
    latitude: Number(candidate.latitude ?? place.latitude),
    longitude: Number(candidate.longitude ?? place.longitude)
  };
  const movement = distanceMeters(place, point);
  const address = String(manual?.address || place.address);
  verified.push({
    id: place.id,
    name: place.name,
    status: manual?.status || result.status,
    movementMeters: Math.round(movement),
    note: manual?.note || ''
  });
  if (movement >= 10 || address !== place.address) {
    operations.push({
      id: place.id,
      name: place.name,
      before: { address: place.address, latitude: place.latitude, longitude: place.longitude },
      after: { address, ...point },
      movementMeters: Math.round(movement),
      source: manual ? manual.note : `Apple地图中国区（高德底图）${result.status}`
    });
  }
}

let backupPath = '';
if (applyChanges && operations.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'full-place-verification-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-poi-fixes-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(projectRoot, 'admin', 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(operations.map((operation) => prisma.place.update({
    where: { id: operation.id },
    data: { ...operation.after, pushedFingerprint: '' }
  })));
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  source: 'Apple地图中国区（高德底图）全量门牌与POI核验；7条自动未决项人工复核',
  backupPath,
  total: current.length,
  verified: verified.length,
  operations: operations.length,
  rejected,
  manualOverrides: [...manualOverrides.entries()].map(([id, value]) => ({ id, ...value })),
  changes: operations
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：核验 ${verified.length} 条，修正 ${operations.length} 条，未通过 ${rejected.length} 条\n${reportPath}\n`);
await prisma.$disconnect();
