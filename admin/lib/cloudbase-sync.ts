import cloudbase from '@cloudbase/node-sdk';
import { prisma } from '@/lib/prisma';
import { toMiniProgramPlace } from '@/lib/place-shape';

export type CloudBaseSyncResult = {
  ok: boolean;
  pushed: number;
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

export async function syncPublishedPlaces(): Promise<CloudBaseSyncResult> {
  const config = getCloudBaseConfig();
  if (!config.env || !config.secretId || !config.secretKey) {
    return { ok: false, pushed: 0, error: 'missing-config' };
  }

  const places = await prisma.place.findMany({
    where: { reviewStatus: 'published' },
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
  let pushed = 0;

  for (let offset = 0; offset < places.length; offset += 20) {
    const batch = places.slice(offset, offset + 20);
    await Promise.all(batch.map(async (place) => {
      const payload = toMiniProgramPlace(place);
      await collection.doc(place.id).set(payload);
      pushed += 1;
    }));
  }

  return { ok: true, pushed };
}
