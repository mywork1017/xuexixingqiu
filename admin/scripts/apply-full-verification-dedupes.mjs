import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(import.meta.dirname, '../..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'full-place-verification-2026-08-09');
const reportPath = path.join(reportDirectory, 'dedupe-result.json');

const decisions = [
  {
    keepId: 'place_14ysagm',
    removeId: 'place_1c5mdhv',
    address: '上海市虹口区广灵四路268号一楼',
    evidence: '虹口区政府现行资料确认同一处凉城新村街道社区长者食堂，地址为广灵四路268号'
  },
  {
    keepId: 'place_ry9mpm',
    removeId: 'cmsl5pfh9002810qsfhets9j9',
    address: '上海市黄浦区九江路210号5室底层',
    evidence: '黄浦区现行养老服务清单确认同一处外滩街道社区长者食堂，地址为九江路210号5室底层'
  }
];

const ids = decisions.flatMap((item) => [item.keepId, item.removeId]);
const places = await prisma.place.findMany({
  where: { id: { in: ids } },
  include: { photos: { orderBy: { sortOrder: 'asc' } } }
});
const placeById = new Map(places.map((place) => [place.id, place]));
const changes = decisions.map((decision) => {
  const keep = placeById.get(decision.keepId);
  const remove = placeById.get(decision.removeId);
  if (!keep || !remove) throw new Error(`缺少待合并地点：${decision.keepId} / ${decision.removeId}`);
  if (keep.category !== remove.category) throw new Error(`类别不一致：${keep.id} / ${remove.id}`);
  const existingUrls = new Set(keep.photos.map((photo) => photo.url));
  const photosToMove = remove.photos.filter((photo) => !existingUrls.has(photo.url));
  return {
    ...decision,
    keepName: keep.name,
    removeName: remove.name,
    beforeAddress: keep.address,
    photosToMove: photosToMove.map((photo) => photo.url)
  };
});

let backupPath = '';
if (applyChanges) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'full-place-verification-2026-08-09');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-targeted-dedupe-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(projectRoot, 'admin', 'prisma', 'dev.db'), backupPath);

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      const keep = placeById.get(decision.keepId);
      const remove = placeById.get(decision.removeId);
      const existingUrls = new Set(keep.photos.map((photo) => photo.url));
      const photosToMove = remove.photos.filter((photo) => !existingUrls.has(photo.url));
      for (const [index, photo] of photosToMove.entries()) {
        await tx.placePhoto.update({
          where: { id: photo.id },
          data: { placeId: keep.id, sortOrder: keep.photos.length + index }
        });
      }
      await tx.place.update({
        where: { id: keep.id },
        data: { address: decision.address, pushedFingerprint: '' }
      });
      await tx.place.delete({ where: { id: remove.id } });
    }
  });
}

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  removed: decisions.length,
  changes
}, null, 2)}\n`);
process.stdout.write(`${applyChanges ? '已应用' : '预演'}：合并并删除 ${decisions.length} 条重复数据\n${reportPath}\n`);
await prisma.$disconnect();
