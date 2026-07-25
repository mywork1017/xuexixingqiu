import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PlaceEditor } from '../place-editor';
import { deletePlace } from '../actions';

export default async function PlaceFormPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const place = id === 'new'
    ? null
    : await prisma.place.findUnique({
      where: { id },
      include: { photos: { orderBy: { sortOrder: 'asc' } } }
    });

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">地点管理</div><h1 className="brand">{place ? '编辑地点' : '新增地点'}</h1></div>
        <div className="topbar-actions"><Link className="button secondary" href="/places">返回列表</Link>{place ? <form action={deletePlace}><input type="hidden" name="id" value={place.id} /><button className="button danger" type="submit">删除地点</button></form> : null}</div>
      </header>
      <section className="panel">
        <PlaceEditor place={{
          id: place?.id,
          name: place?.name,
          category: place?.category,
          address: place?.address,
          latitude: place?.latitude,
          longitude: place?.longitude,
          hours: place?.hours,
          description: place?.description,
          facilities: place?.facilities,
          photos: (place?.photos || []).map((photo) => photo.url),
          source: place?.source,
          sourceUrl: place?.sourceUrl,
          reviewStatus: place?.reviewStatus
        }} />
      </section>
    </main>
  );
}
