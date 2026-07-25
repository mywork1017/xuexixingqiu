'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { CATEGORY_OPTIONS, parseList } from '@/lib/place-shape';
import { requireAdmin } from '@/lib/auth';
import { syncPublishedPlaces } from '@/lib/cloudbase-sync';

const REVIEW_VALUES = new Set(['pending', 'draft', 'published', 'archived']);

function allowed(value: FormDataEntryValue | null, values: Set<string>, fallback: string) {
  const normalized = String(value || fallback);
  return values.has(normalized) ? normalized : fallback;
}

export async function savePlace(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  const category = String(formData.get('category') || '');
  const latitude = Number(formData.get('latitude'));
  const longitude = Number(formData.get('longitude'));
  const photos = parseList(formData.get('photos'));

  if (photos.length > 5) {
    throw new Error('每个地点最多保存 5 张照片');
  }

  if (!String(formData.get('name') || '').trim()) {
    throw new Error('地点名称不能为空');
  }

  if (!CATEGORY_OPTIONS.includes(category)) {
    throw new Error('地点分类不正确');
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('经纬度不能为空');
  }

  const data = {
    name: String(formData.get('name') || '').trim(),
    category,
    address: String(formData.get('address') || '').trim(),
    latitude,
    longitude,
    hours: String(formData.get('hours') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    facilities: String(formData.get('facilities') || '').trim(),
    tagsJson: JSON.stringify(parseList(formData.get('tags'))),
    source: String(formData.get('source') || 'admin').trim(),
    sourceUrl: String(formData.get('sourceUrl') || '').trim(),
    reviewStatus: allowed(formData.get('reviewStatus'), REVIEW_VALUES, 'draft')
  };

  const place = id
    ? await prisma.place.update({ where: { id }, data })
    : await prisma.place.create({ data });

  await prisma.placePhoto.deleteMany({ where: { placeId: place.id } });
  await prisma.placePhoto.createMany({
    data: photos.map((url, index) => ({
      placeId: place.id,
      url,
      sortOrder: index
    }))
  });

  redirect(`/places/${place.id}`);
}

export async function deletePlace(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (id) await prisma.place.delete({ where: { id } });
  redirect('/places');
}

export async function pushPublishedPlaces() {
  await requireAdmin();
  let result;
  try {
    result = await syncPublishedPlaces();
  } catch (error) {
    console.error('CloudBase sync failed', error);
    redirect('/places?sync=failed');
  }
  if (!result.ok) redirect('/places?sync=missing');
  redirect(`/places?sync=success&pushed=${result.pushed}`);
}
