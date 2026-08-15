import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const auditPath = path.join(projectRoot, 'data', 'research', 'map-position-audit-2026-08-02.json');
const secondPassPath = path.join(
  projectRoot,
  'data',
  'research',
  'map-position-second-pass-2026-08-02.json'
);
const reportPath = path.join(projectRoot, 'data', 'research', 'map-position-apply-result.json');
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
const secondPass = JSON.parse(await fs.readFile(secondPassPath, 'utf8'));
const verifiedSecondPass = new Map(
  (secondPass.results || [])
    .filter((result) => result.status === 'verified_poi')
    .map((result) => [result.id, result])
);
const currentPlaces = await prisma.place.findMany({
  where: { category: { in: ['图书馆', '食堂'] } },
  select: { id: true, name: true, address: true, latitude: true, longitude: true }
});
const currentById = new Map(currentPlaces.map((place) => [place.id, place]));

function distanceMeters(first, second) {
  const radians = Math.PI / 180;
  const deltaLatitude = (second.latitude - first.latitude) * radians;
  const deltaLongitude = (second.longitude - first.longitude) * radians;
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(first.latitude * radians)
      * Math.cos(second.latitude * radians)
      * Math.sin(deltaLongitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

const operations = [];
const review = [];
for (const result of audit.results || []) {
  const current = currentById.get(result.id);
  if (!current) continue;
  const verifiedPoi = verifiedSecondPass.get(result.id);
  if (verifiedPoi) {
    const point = {
      latitude: Number(verifiedPoi.latitude),
      longitude: Number(verifiedPoi.longitude)
    };
    const movement = distanceMeters(current, point);
    if (Number.isFinite(movement) && movement >= 10) {
      operations.push({
        id: current.id,
        name: current.name,
        address: current.address,
        before: { latitude: current.latitude, longitude: current.longitude },
        after: point,
        movementMeters: Math.round(movement),
        source: '百度地图 POI 名称与道路门牌复核'
      });
    }
    continue;
  }
  if (result.status !== 'located') {
    review.push({
      id: current.id,
      name: current.name,
      address: current.address,
      reason: result.status
    });
    continue;
  }
  const point = {
    latitude: Number(result.mapLatitude),
    longitude: Number(result.mapLongitude)
  };
  const movement = distanceMeters(current, point);
  if (!Number.isFinite(movement) || movement > 500) {
    review.push({
      id: current.id,
      name: current.name,
      address: current.address,
      reason: '地图结果与现有点位相距超过500米',
      movementMeters: Math.round(movement)
    });
    continue;
  }
  if (movement >= 10) {
    operations.push({
      id: current.id,
      name: current.name,
      address: current.address,
      before: { latitude: current.latitude, longitude: current.longitude },
      after: point,
      movementMeters: Math.round(movement),
      source: '百度地图地址结果，移动距离不超过 500 米'
    });
  }
}

let backupPath = '';
if (applyChanges && operations.length) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'map-position-2026-08-02');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(
    backupDirectory,
    `dev-before-map-update-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  await prisma.$transaction(
    operations.map((operation) => prisma.place.update({
      where: { id: operation.id },
      data: {
        latitude: operation.after.latitude,
        longitude: operation.after.longitude,
        pushedFingerprint: ''
      }
    }))
  );
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  updateThresholdMeters: 10,
  maximumAutomaticMovementMeters: 500,
  verifiedPoiSecondPass: verifiedSecondPass.size,
  operations,
  review
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已写入' : '预演'}地图点位 ${operations.length} 条；待人工复核 ${review.length} 条\n`);
process.stdout.write(`${reportPath}\n`);
await prisma.$disconnect();
