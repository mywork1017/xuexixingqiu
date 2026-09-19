import cloudbase from '@cloudbase/node-sdk';
import { getCloudBaseConfig } from '@/lib/cloudbase-sync';
import { prisma } from '@/lib/prisma';

export type VisitRow = {
  id: string;
  visitorCode: string;
  visitorName: string;
  nation: string;
  province: string;
  city: string;
  district: string;
  street: string;
  placeName: string;
  address: string;
  locationLevel: 'place' | 'street' | 'district' | 'city' | 'unknown';
  accuracy: number | null;
  createdAt: string;
};

export type VisitQueryResult = {
  ok: boolean;
  rows: VisitRow[];
  error?: 'missing-config' | 'query-failed';
};

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  return '';
}

export async function getRecentVisits(): Promise<VisitQueryResult> {
  const config = getCloudBaseConfig();
  if (!config.env || !config.secretId || !config.secretKey) {
    return { ok: false, rows: [], error: 'missing-config' };
  }

  try {
    const app = cloudbase.init({
      env: config.env,
      region: 'ap-shanghai',
      secretId: config.secretId,
      secretKey: config.secretKey
    });
    const [result, visitorAliases] = await Promise.all([
      app.database()
        .collection(process.env.CLOUDBASE_VISIT_COLLECTION || 'visitLogs')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get(),
      prisma.visitorAlias.findMany({ select: { visitorCode: true, name: true } })
    ]);
    const visitorNames = new Map(visitorAliases.map((item) => [item.visitorCode, item.name]));

    const rows = result.data.map((item) => ({
      id: String(item._id || ''),
      visitorCode: String(item.visitorCode || ''),
      visitorName: visitorNames.get(String(item.visitorCode || '')) || '',
      nation: String(item.nation || ''),
      province: String(item.province || ''),
      city: String(item.city || ''),
      district: String(item.district || ''),
      street: String(item.street || ''),
      placeName: String(item.placeName || ''),
      address: String(item.address || ''),
      locationLevel: ['place', 'street', 'district', 'city'].includes(item.locationLevel)
        ? item.locationLevel
        : 'unknown',
      accuracy: Number.isFinite(Number(item.accuracy)) ? Number(item.accuracy) : null,
      createdAt: toIsoString(item.createdAt)
    }));
    return { ok: true, rows };
  } catch (error) {
    console.error('query visit logs failed', error);
    return { ok: false, rows: [], error: 'query-failed' };
  }
}
