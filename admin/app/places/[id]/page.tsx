import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PlaceEditorPageView } from '../place-editor-page-view';

export default async function PlaceFormPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const place = await prisma.place.findUnique({
    where: { id },
    include: { photos: { orderBy: { sortOrder: 'asc' } } }
  });
  if (!place) notFound();

  return (
    <PlaceEditorPageView
      place={{
        id: place.id,
        name: place.name,
        category: place.category,
        address: place.address,
        hours: place.hours,
        description: place.description,
        photos: place.photos.map((photo) => photo.url)
      }}
    />
  );
}
