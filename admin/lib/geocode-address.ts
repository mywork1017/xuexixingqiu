function transformLatitude(x: number, y: number) {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  value += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return value;
}

function transformLongitude(x: number, y: number) {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  value += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return value;
}

function wgs84ToGcj02(longitude: number, latitude: number) {
  const earthRadius = 6378245;
  const eccentricity = 0.006693421622965943;
  let latitudeOffset = transformLatitude(longitude - 105, latitude - 35);
  let longitudeOffset = transformLongitude(longitude - 105, latitude - 35);
  const radianLatitude = latitude / 180 * Math.PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - eccentricity * magic * magic;
  const squareRootMagic = Math.sqrt(magic);
  latitudeOffset = latitudeOffset * 180
    / ((earthRadius * (1 - eccentricity)) / (magic * squareRootMagic) * Math.PI);
  longitudeOffset = longitudeOffset * 180
    / (earthRadius / squareRootMagic * Math.cos(radianLatitude) * Math.PI);
  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset
  };
}

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

export async function geocodeShanghaiAddress(address: string) {
  const endpoint = new URL('https://nominatim.openstreetmap.org/search');
  endpoint.searchParams.set('q', `${address}, 上海市, 中国`);
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('limit', '5');
  endpoint.searchParams.set('countrycodes', 'cn');
  const response = await fetch(endpoint, {
    headers: { 'User-Agent': 'ShanghaiStudyMap/1.0 (local admin)' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`地址定位失败：${response.status}`);
  const rows = await response.json() as NominatimResult[];
  const match = rows.find((row) => {
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= 30.6
      && latitude <= 31.9
      && longitude >= 120.8
      && longitude <= 122.2;
  });
  if (match) return wgs84ToGcj02(Number(match.lon), Number(match.lat));

  const fallback = new URL(
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
  );
  fallback.searchParams.set('SingleLine', address);
  fallback.searchParams.set('f', 'json');
  fallback.searchParams.set('outFields', 'Match_addr,Addr_type');
  fallback.searchParams.set('countryCode', 'CHN');
  fallback.searchParams.set('maxLocations', '5');
  const fallbackResponse = await fetch(fallback, { cache: 'no-store' });
  if (!fallbackResponse.ok) throw new Error(`地址定位失败：${fallbackResponse.status}`);
  const fallbackPayload = await fallbackResponse.json() as {
    candidates?: Array<{
      score?: number;
      location?: { x?: number; y?: number };
      attributes?: { Addr_type?: string };
    }>;
  };
  const exact = (fallbackPayload.candidates || []).find((candidate) => (
    Number(candidate.score) >= 90
    && ['PointAddress', 'Subaddress', 'StreetAddress'].includes(String(candidate.attributes?.Addr_type || ''))
    && Number(candidate.location?.y) >= 30.6
    && Number(candidate.location?.y) <= 31.9
    && Number(candidate.location?.x) >= 120.8
    && Number(candidate.location?.x) <= 122.2
  ));
  if (!exact) throw new Error('地址无法唯一定位，请补全区、道路和门牌号后再保存');
  return wgs84ToGcj02(Number(exact.location?.x), Number(exact.location?.y));
}
