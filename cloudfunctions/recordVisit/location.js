const crypto = require('node:crypto');

const SHANGHAI_BOUNDS = {
  southwest: { latitude: 30.65, longitude: 120.85 },
  northeast: { latitude: 31.9, longitude: 122.25 }
};

function isWithinShanghaiBounds(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= SHANGHAI_BOUNDS.southwest.latitude
    && latitude <= SHANGHAI_BOUNDS.northeast.latitude
    && longitude >= SHANGHAI_BOUNDS.southwest.longitude
    && longitude <= SHANGHAI_BOUNDS.northeast.longitude;
}

function createVisitorIdentity(openid, appid) {
  const visitorId = crypto.createHash('sha256')
    .update(`${appid || 'miniprogram'}:${openid || 'anonymous'}`)
    .digest('hex');
  return {
    visitorId,
    visitorCode: visitorId.slice(0, 6).toUpperCase()
  };
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function selectNearbyPlace(pois) {
  if (!Array.isArray(pois)) return '';
  const normalized = pois.map((poi) => ({
    title: stringValue(poi && poi.title),
    category: stringValue(poi && poi.category),
    distance: Number(poi && poi._distance)
  })).filter((poi) => poi.title && Number.isFinite(poi.distance));
  const residential = normalized.find((poi) => poi.distance <= 200
    && /小区|住宅|社区|公寓|家园|花园/.test(`${poi.title}${poi.category}`));
  if (residential) return residential.title;
  const nearest = normalized.find((poi) => poi.distance <= 80);
  return nearest ? nearest.title : '';
}

function parseReverseGeocode(payload, latitude, longitude) {
  const result = payload && payload.status === 0 && payload.result
    ? payload.result
    : {};
  const adInfo = result.ad_info || {};
  const component = result.address_component || {};
  const formatted = result.formatted_addresses || {};
  const nation = stringValue(adInfo.nation || component.nation);
  const province = stringValue(adInfo.province || component.province);
  const city = stringValue(adInfo.city || component.city || province);
  const district = stringValue(adInfo.district || component.district);
  const street = stringValue(component.street_number || component.street);
  const placeName = selectNearbyPlace(result.pois);
  const address = stringValue(formatted.standard_address || formatted.recommend || result.address);
  const isShanghai = city === '上海市'
    || (!city && isWithinShanghaiBounds(latitude, longitude));
  const locationLevel = placeName
    ? 'place'
    : street
      ? 'street'
      : district
        ? 'district'
        : city
          ? 'city'
          : 'unknown';
  return {
    nation,
    province,
    city: city || (isShanghai ? '上海市' : ''),
    district,
    street,
    placeName,
    address,
    locationLevel,
    isShanghai
  };
}

module.exports = {
  createVisitorIdentity,
  isWithinShanghaiBounds,
  parseReverseGeocode
};
