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

function parseReverseGeocode(payload, latitude, longitude) {
  const address = payload && payload.status === 0 && payload.result
    ? payload.result.ad_info || {}
    : {};
  const city = String(address.city || '');
  const district = String(address.district || '');
  const isShanghai = city === '上海市'
    || (!city && isWithinShanghaiBounds(latitude, longitude));
  return {
    city: city || (isShanghai ? '上海市' : ''),
    district,
    isShanghai
  };
}

module.exports = {
  createVisitorIdentity,
  isWithinShanghaiBounds,
  parseReverseGeocode
};
