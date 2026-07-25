export type CandidateInput = {
  name: string;
  category: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  hours: string;
  description: string;
  source: string;
  sourceUrl: string;
  raw: unknown;
};

const OFFICIAL_URL = 'https://whlyj.sh.gov.cn/tsg/20251009/d365d0082cc94164b15fa9202675b785.html';

function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseOfficialLibraries(html: string): CandidateInput[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const results: CandidateInput[] = [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(decodeHtml);
    const nameIndex = cells.findIndex((cell) => /图书馆|城市书房|阅读空间|服务点/.test(cell));
    if (nameIndex < 0 || /名称|名录/.test(cells[nameIndex])) continue;
    const name = cells[nameIndex];
    const address = cells[nameIndex + 1] || '';
    const hours = cells[nameIndex + 2] || '';
    if (!name || !address) continue;
    results.push({
      name, category: '图书馆', address, latitude: null, longitude: null, hours,
      description: cells.slice(nameIndex + 4).filter(Boolean).join('；'),
      source: '上海市文旅局', sourceUrl: OFFICIAL_URL, raw: { cells }
    });
  }
  return results;
}

export async function fetchOfficialLibraries() {
  const response = await fetch(OFFICIAL_URL, { headers: { 'User-Agent': 'ShanghaiStudyMap/1.0' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`官方名录读取失败：${response.status}`);
  const results = parseOfficialLibraries(await response.text());
  if (!results.length) throw new Error('官方名录页面结构已变化，暂未读取到地点');
  return results;
}

function transformLat(x: number, y: number) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  result += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return result;
}

function transformLon(x: number, y: number) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  result += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return result;
}

export function wgs84ToGcj02(longitude: number, latitude: number) {
  const a = 6378245; const ee = 0.006693421622965943;
  let dLat = transformLat(longitude - 105, latitude - 35);
  let dLon = transformLon(longitude - 105, latitude - 35);
  const radLat = latitude / 180 * Math.PI;
  let magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLon = dLon * 180 / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { latitude: latitude + dLat, longitude: longitude + dLon };
}

export async function fetchOsmLibraries() {
  const query = `[out:json][timeout:60];nwr["amenity"="library"](30.67,120.85,31.88,122.2);out center tags;`;
  const endpoint = new URL('https://overpass-api.de/api/interpreter');
  endpoint.searchParams.set('data', query);
  const response = await fetch(endpoint, { headers: { 'User-Agent': 'ShanghaiStudyMap/1.0' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`OpenStreetMap 读取失败：${response.status}`);
  const payload = await response.json();
  return (payload.elements || []).flatMap((item: Record<string, any>) => {
    const latitude = Number(item.lat ?? item.center?.lat);
    const longitude = Number(item.lon ?? item.center?.lon);
    const name = String(item.tags?.['name:zh'] || item.tags?.name || '').trim();
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const point = wgs84ToGcj02(longitude, latitude);
    const address = [item.tags?.['addr:district'], item.tags?.['addr:street'], item.tags?.['addr:housenumber']].filter(Boolean).join('');
    return [{
      name, category: '图书馆', address, latitude: point.latitude, longitude: point.longitude,
      hours: String(item.tags?.opening_hours || ''), description: '', source: 'OpenStreetMap',
      sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`, raw: item
    } satisfies CandidateInput];
  });
}
