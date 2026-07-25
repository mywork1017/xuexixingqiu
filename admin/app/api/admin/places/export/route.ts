import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toMiniProgramPlace } from '@/lib/place-shape';

export async function GET() {
  const places = await prisma.place.findMany({
    where: { reviewStatus: 'published' },
    orderBy: { updatedAt: 'desc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } }
  });

  return NextResponse.json(places.map(toMiniProgramPlace));
}
