'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import {
  CATEGORY_OPTIONS,
  isEligibleCanteenName,
  isExcludedPlaceType,
  isExcludedSchoolPlace,
  isRestrictedInstitutionPlace,
  parseList
} from '@/lib/place-shape';
import { requireAdmin } from '@/lib/auth';
import { syncPublishedPlaces } from '@/lib/cloudbase-sync';
import { sanitizePlaceDescription } from '@/lib/description-cleaner';
import { geocodeShanghaiAddress } from '@/lib/geocode-address';

export async function savePlace(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) {
    throw new Error('只能编辑现有地点');
  }
  const category = String(formData.get('category') || '');
  const photos = parseList(formData.get('photos'));

  if (photos.length > 5) {
    throw new Error('每个地点最多保存 5 张照片');
  }

  const name = String(formData.get('name') || '').trim();
  if (!name) {
    throw new Error('地点名称不能为空');
  }

  if (isExcludedSchoolPlace(name)) {
    throw new Error('不采集学校内部地点');
  }

  if (isRestrictedInstitutionPlace(name)) {
    throw new Error('不采集单位或机关内部地点');
  }

  if (isExcludedPlaceType(name)) {
    throw new Error('复合场所名称必须明确包含图书馆，城市书房不采集');
  }

  if (!CATEGORY_OPTIONS.includes(category)) {
    throw new Error('地点分类不正确');
  }

  if (category === '食堂' && !isEligibleCanteenName(name)) {
    throw new Error('食堂仅采集社区、长者、老年及公益助餐场所');
  }

  const address = String(formData.get('address') || '').trim();
  if (!address) {
    throw new Error('地址不能为空');
  }

  const existing = await prisma.place.findUnique({
    where: { id },
    select: { address: true, latitude: true, longitude: true }
  });
  if (!existing) {
    throw new Error('地点不存在');
  }
  const point = existing && existing.address === address
    ? { latitude: existing.latitude, longitude: existing.longitude }
    : await geocodeShanghaiAddress(address);

  const data = {
    name,
    category,
    address,
    latitude: point.latitude,
    longitude: point.longitude,
    hours: String(formData.get('hours') || '').trim(),
    description: sanitizePlaceDescription(String(formData.get('description') || ''))
  };

  const place = await prisma.place.update({ where: { id }, data });

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
  redirect(`/places?sync=success&pushed=${result.pushed}&deleted=${result.deleted}`);
}
