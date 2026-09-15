import cloudbase from '@cloudbase/node-sdk';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { getPlaceFingerprint } from '@/lib/place-fingerprint';
import { toMiniProgramPlace } from '@/lib/place-shape';

export type CloudBaseSyncResult = {
  ok: boolean;
  pushed: number;
  deleted: number;
  error?: string;
};

export function getCloudBaseConfig() {
  return {
    env: process.env.CLOUDBASE_ENV_ID || '',
    secretId: process.env.TENCENTCLOUD_SECRET_ID || '',
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY || '',
    collection: process.env.CLOUDBASE_COLLECTION || 'places'
  };
}

async function uploadLocalPhotos(
  app: ReturnType<typeof cloudbase.init>,
  placeId: string,
  photos: string[]
) {
  const publicRoot = path.resolve(process.cwd(), 'public');

  return Promise.all(photos.map(async (url, index) => {
    if (!url.startsWith('/uploads/')) return url;

    const localPath = path.resolve(publicRoot, `.${url}`);
    if (!localPath.startsWith(`${publicRoot}${path.sep}`) || !existsSync(localPath)) {
      throw new Error(`找不到地点图片：${url}`);
    }

    const extension = path.extname(localPath).toLowerCase() || '.jpg';
    const result = await app.uploadFile({
      cloudPath: `place-photos/${placeId}/${index + 1}${extension}`,
      fileContent: createReadStream(localPath)
    });
    return result.fileID;
  }));
}

export async function syncPublishedPlaces(): Promise<CloudBaseSyncResult> {
  const config = getCloudBaseConfig();
  if (!config.env || !config.secretId || !config.secretKey) {
    return { ok: false, pushed: 0, deleted: 0, error: 'missing-config' };
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
  const database = app.database();
  const collection = database.collection(config.collection);
  const publishedIds = new Set(places.map((place) => place.id));
  const cloudIds = new Set<string>();
  const staleIds: string[] = [];
  const pageSize = 100;

  for (let offset = 0; ; offset += pageSize) {
    const page = await collection.field({ _id: true }).skip(offset).limit(pageSize).get();
    const ids = page.data
      .map((item) => String(item._id || ''))
      .filter(Boolean);
    ids.forEach((id) => cloudIds.add(id));
    staleIds.push(...ids.filter((id) => !publishedIds.has(id)));
    if (ids.length < pageSize) break;
  }

  const placesToPush = places.filter((place) => (
    !cloudIds.has(place.id)
    || place.pushedFingerprint !== getPlaceFingerprint(place)
  ));
  let pushed = 0;
  let deleted = 0;
  const pushedFingerprints: Array<{ id: string; fingerprint: string }> = [];

  for (let offset = 0; offset < placesToPush.length; offset += 20) {
    const batch = placesToPush.slice(offset, offset + 20);
    await Promise.all(batch.map(async (place) => {
      const fingerprint = getPlaceFingerprint(place);
      const payload = toMiniProgramPlace(place);
      payload.photos = await uploadLocalPhotos(app, place.id, payload.photos);
      await collection.doc(place.id).set(payload);
      pushedFingerprints.push({ id: place.id, fingerprint });
      pushed += 1;
    }));
  }

  for (let offset = 0; offset < staleIds.length; offset += 20) {
    const batch = staleIds.slice(offset, offset + 20);
    await Promise.all(batch.map(async (id) => {
      await collection.doc(id).remove();
      deleted += 1;
    }));
  }

  for (let offset = 0; offset < pushedFingerprints.length; offset += 100) {
    const batch = pushedFingerprints.slice(offset, offset + 100);
    await prisma.$transaction(batch.map((item) => prisma.place.update({
      where: { id: item.id },
      data: { pushedFingerprint: item.fingerprint }
    })));
  }

  return { ok: true, pushed, deleted };
}
