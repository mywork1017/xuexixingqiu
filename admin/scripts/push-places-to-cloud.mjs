import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import cloudbase from '@cloudbase/node-sdk';

process.env.DATABASE_URL ||= 'file:./dev.db';
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const config = {
  env: process.env.CLOUDBASE_ENV_ID || '',
  secretId: process.env.TENCENTCLOUD_SECRET_ID || '',
  secretKey: process.env.TENCENTCLOUD_SECRET_KEY || '',
  collection: process.env.CLOUDBASE_COLLECTION || 'places'
};
if (!config.env || !config.secretId || !config.secretKey) {
  throw new Error('缺少 CloudBase 同步配置');
}

const places = await prisma.place.findMany({
  orderBy: { updatedAt: 'asc' },
  include: { photos: { orderBy: { sortOrder: 'asc' } } }
});
const app = cloudbase.init({
  env: config.env,
  region: 'ap-shanghai',
  secretId: config.secretId,
  secretKey: config.secretKey
});
const collection = app.database().collection(config.collection);
const publicRoot = path.resolve(import.meta.dirname, '..', 'public');

const fingerprint = (place) => createHash('sha256').update(JSON.stringify({
  name: place.name,
  category: place.category,
  latitude: place.latitude,
  longitude: place.longitude,
  address: place.address,
  hours: place.hours,
  description: place.description,
  photos: place.photos.map((photo) => photo.url)
})).digest('hex');

const uploadPhotos = async (place) => Promise.all(place.photos.map(async (photo, index) => {
  if (!photo.url.startsWith('/uploads/')) return photo.url;
  const localPath = path.resolve(publicRoot, `.${photo.url}`);
  if (!localPath.startsWith(`${publicRoot}${path.sep}`) || !existsSync(localPath)) {
    throw new Error(`找不到地点图片：${photo.url}`);
  }
  const extension = path.extname(localPath).toLowerCase() || '.jpg';
  const uploaded = await app.uploadFile({
    cloudPath: `place-photos/${place.id}/${index + 1}${extension}`,
    fileContent: createReadStream(localPath)
  });
  return uploaded.fileID;
}));

const localIds = new Set(places.map((place) => place.id));
const staleIds = [];
for (let offset = 0; ; offset += 100) {
  const page = await collection.field({ _id: true }).skip(offset).limit(100).get();
  const ids = page.data.map((item) => String(item._id || '')).filter(Boolean);
  staleIds.push(...ids.filter((id) => !localIds.has(id)));
  if (ids.length < 100) break;
}

const pushedFingerprints = [];
for (let offset = 0; offset < places.length; offset += 20) {
  const batch = places.slice(offset, offset + 20);
  await Promise.all(batch.map(async (place) => {
    const photos = await uploadPhotos(place);
    await collection.doc(place.id).set({
      id: place.id,
      name: place.name,
      category: place.category,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      hours: place.hours,
      description: place.description,
      photos,
      updatedAt: place.updatedAt.toISOString().slice(0, 10)
    });
    pushedFingerprints.push({ id: place.id, fingerprint: fingerprint(place) });
  }));
  process.stdout.write(`已推送 ${Math.min(offset + batch.length, places.length)}/${places.length}\n`);
}

for (let offset = 0; offset < staleIds.length; offset += 20) {
  await Promise.all(staleIds.slice(offset, offset + 20).map((id) => collection.doc(id).remove()));
}
for (let offset = 0; offset < pushedFingerprints.length; offset += 100) {
  const batch = pushedFingerprints.slice(offset, offset + 100);
  await prisma.$transaction(batch.map((item) => prisma.place.update({
    where: { id: item.id },
    data: { pushedFingerprint: item.fingerprint }
  })));
}

process.stdout.write(`同步完成：推送 ${places.length} 条，清理云端旧记录 ${staleIds.length} 条\n`);
await prisma.$disconnect();
