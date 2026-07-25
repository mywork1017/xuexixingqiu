import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const payload = await request.json();
  const candidate = await prisma.importCandidate.create({
    data: {
      name: String(payload.name || ''),
      category: String(payload.category || ''),
      address: String(payload.address || ''),
      latitude: payload.latitude === undefined ? null : Number(payload.latitude),
      longitude: payload.longitude === undefined ? null : Number(payload.longitude),
      hours: String(payload.hours || ''),
      description: String(payload.description || ''),
      facilities: String(payload.facilities || ''),
      tagsJson: JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
      photoUrlsJson: JSON.stringify(Array.isArray(payload.photos) ? payload.photos : []),
      source: String(payload.source || 'xcrawl'),
      sourceUrl: String(payload.sourceUrl || ''),
      rawJson: JSON.stringify(payload.raw || payload)
    }
  });

  return NextResponse.json({ ok: true, id: candidate.id });
}
