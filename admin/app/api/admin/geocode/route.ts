import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { wgs84ToGcj02 } from '@/lib/importers';

export async function GET(request: Request) {
  await requireAdmin();
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';
  if (!q) return NextResponse.json({ ok: true, query: q, results: [] });
  const endpoint = new URL('https://nominatim.openstreetmap.org/search');
  endpoint.searchParams.set('q', `${q}, 上海市`);
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('limit', '8');
  endpoint.searchParams.set('countrycodes', 'cn');
  const response = await fetch(endpoint, { headers: { 'User-Agent': 'ShanghaiStudyMap/1.0 (local admin)' }, cache: 'no-store' });
  if (!response.ok) return NextResponse.json({ ok: false, error: `地址搜索失败：${response.status}` }, { status: 502 });
  const payload = await response.json();
  const results = payload.map((item: Record<string, string>) => {
    const point = wgs84ToGcj02(Number(item.lon), Number(item.lat));
    return { name: item.name || item.display_name?.split(',')[0] || q, address: item.display_name || '', ...point };
  });
  return NextResponse.json({ ok: true, query: q, results });
}
