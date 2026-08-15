import { prisma } from '@/lib/prisma';
import { toMiniProgramPlace } from '@/lib/place-shape';
import { isAdminRequest } from '@/lib/auth';

function encodeCsvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(';') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return Response.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const places = await prisma.place.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } }
  });

  const fields = [
    'id',
    'name',
    'category',
    'latitude',
    'longitude',
    'address',
    'hours',
    'description',
    'photos',
    'updatedAt'
  ] as const;
  const rows = places.map(toMiniProgramPlace);
  const csv = [
    fields.join(','),
    ...rows.map((place) => fields.map((field) => encodeCsvCell(place[field])).join(','))
  ].join('\n');

  return new Response(`\uFEFF${csv}\n`, {
    headers: {
      'Content-Disposition': 'attachment; filename="places-backup.csv"',
      'Content-Type': 'text/csv; charset=utf-8'
    }
  });
}
