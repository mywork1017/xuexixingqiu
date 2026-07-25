'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchOfficialLibraries, fetchOsmLibraries, type CandidateInput } from '@/lib/importers';

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s·•（）()\-—]/g, '');
}

async function saveCandidates(items: CandidateInput[]) {
  const places = await prisma.place.findMany({ select: { id: true, name: true, address: true } });
  const candidates = await prisma.importCandidate.findMany({ select: { id: true, name: true, address: true, source: true, reviewStatus: true } });
  let created = 0; let updated = 0;
  for (const item of items) {
    const current = candidates.find((candidate) => candidate.source === item.source && normalize(candidate.name) === normalize(item.name) && normalize(candidate.address) === normalize(item.address));
    const matched = places.find((place) => normalize(place.name) === normalize(item.name) || (item.address && normalize(place.address) === normalize(item.address)));
    const data = {
      name: item.name, category: item.category, address: item.address,
      latitude: item.latitude, longitude: item.longitude, hours: item.hours,
      description: item.description, facilities: '', source: item.source, sourceUrl: item.sourceUrl,
      rawJson: JSON.stringify(item.raw), matchedPlaceId: matched?.id || '',
      reviewStatus: current?.reviewStatus === 'approved' || current?.reviewStatus === 'ignored' ? current.reviewStatus : 'pending'
    };
    if (current) { await prisma.importCandidate.update({ where: { id: current.id }, data }); updated += 1; }
    else { await prisma.importCandidate.create({ data }); created += 1; }
  }
  return { created, updated };
}

export async function runImport(formData: FormData) {
  await requireAdmin();
  const source = String(formData.get('source') || 'official');
  const items = source === 'osm' ? await fetchOsmLibraries() : await fetchOfficialLibraries();
  const result = await saveCandidates(items);
  redirect(`/import-candidates?source=${source}&created=${result.created}&updated=${result.updated}`);
}

export async function reviewCandidate(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  const decision = String(formData.get('decision') || 'draft');
  const candidate = await prisma.importCandidate.findUnique({ where: { id } });
  if (!candidate) redirect('/import-candidates');
  if (decision === 'ignored') {
    await prisma.importCandidate.update({ where: { id }, data: { reviewStatus: 'ignored' } });
    redirect('/import-candidates');
  }
  const latitude = Number(formData.get('latitude'));
  const longitude = Number(formData.get('longitude'));
  const data = {
    name: String(formData.get('name') || candidate.name).trim(),
    category: String(formData.get('category') || candidate.category || '图书馆'),
    address: String(formData.get('address') || '').trim(),
    latitude: Number.isFinite(latitude) ? latitude : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
    hours: String(formData.get('hours') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    facilities: String(formData.get('facilities') || '').trim(),
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    reviewStatus: decision === 'published' ? 'published' : 'draft'
  };
  const place = candidate.matchedPlaceId
    ? await prisma.place.update({ where: { id: candidate.matchedPlaceId }, data })
    : await prisma.place.create({ data });
  await prisma.importCandidate.update({ where: { id }, data: { reviewStatus: 'approved', matchedPlaceId: place.id } });
  revalidatePath('/places'); revalidatePath('/import-candidates');
  redirect(`/places/${place.id}`);
}

export async function approveAllCandidates() {
  await requireAdmin();
  const candidates = await prisma.importCandidate.findMany({
    where: { reviewStatus: 'pending' },
    orderBy: { createdAt: 'asc' }
  });
  const places = await prisma.place.findMany({ select: { id: true, name: true, address: true } });
  let approved = 0;
  for (const candidate of candidates) {
    const matched = candidate.matchedPlaceId
      ? places.find((place) => place.id === candidate.matchedPlaceId)
      : places.find((place) => normalize(place.name) === normalize(candidate.name) || (candidate.address && normalize(place.address) === normalize(candidate.address)));
    const hasCoordinates = candidate.latitude !== null && candidate.longitude !== null && candidate.latitude !== 0 && candidate.longitude !== 0;
    const data = {
      name: candidate.name,
      category: candidate.category || '图书馆',
      address: candidate.address,
      latitude: candidate.latitude || 0,
      longitude: candidate.longitude || 0,
      hours: candidate.hours,
      description: candidate.description,
      facilities: candidate.facilities,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      reviewStatus: hasCoordinates ? 'published' : 'draft'
    };
    const place = matched
      ? await prisma.place.update({ where: { id: matched.id }, data })
      : await prisma.place.create({ data });
    if (!matched) places.push({ id: place.id, name: place.name, address: place.address });
    await prisma.importCandidate.update({ where: { id: candidate.id }, data: { reviewStatus: 'approved', matchedPlaceId: place.id } });
    approved += 1;
  }
  revalidatePath('/places');
  revalidatePath('/import-candidates');
  redirect(`/import-candidates?status=approved&approved=${approved}`);
}
