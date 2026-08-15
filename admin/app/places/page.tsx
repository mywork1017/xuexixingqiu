import { requireAdmin } from '@/lib/auth';
import { getPlaceFingerprint } from '@/lib/place-fingerprint';
import { prisma } from '@/lib/prisma';
import { pushPublishedPlaces } from './actions';
import { PlacesPageView } from './places-page-view';

export default async function PlacesPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    sync?: string;
    pushed?: string;
    deleted?: string;
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = params.q || '';
  const category = params.category || '';
  const status = params.status || '';
  const places = await prisma.place.findMany({
    where: {
      name: q ? { contains: q } : undefined,
      category: category || undefined
    },
    orderBy: { updatedAt: 'desc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } }
  });

  const rows = places.map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    address: place.address,
    hours: place.hours,
    description: place.description,
    pushState: place.pushedFingerprint === getPlaceFingerprint(place) ? 'pushed' as const : 'unpushed' as const
  })).filter((place) => !status || place.pushState === status);

  return (
    <PlacesPageView
      filters={{ q, category: category || 'all', status: status || 'all' }}
      deleted={params.deleted}
      pushAction={pushPublishedPlaces}
      pushed={params.pushed}
      rows={rows}
      sync={params.sync}
    />
  );
}
