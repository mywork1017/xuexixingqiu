const cloud = require('wx-server-sdk');
const https = require('node:https');
const {
  createVisitorIdentity,
  parseReverseGeocode
} = require('./location');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const VISIT_COLLECTION = process.env.VISIT_COLLECTION || 'visitLogs';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('reverse geocode timeout')));
    request.on('error', reject);
  });
}

async function reverseGeocode(latitude, longitude) {
  const key = process.env.TENCENT_MAP_KEY || '';
  if (!key) {
    return {
      ...parseReverseGeocode(null, latitude, longitude),
      geocodeStatus: 'missing-key',
      geocodeMessage: ''
    };
  }

  const url = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
  url.searchParams.set('location', `${latitude},${longitude}`);
  url.searchParams.set('key', key);
  url.searchParams.set('get_poi', '1');
  url.searchParams.set('poi_options', 'address_format=short;radius=500;policy=1;orderby=_distance');
  try {
    const payload = await requestJson(url);
    return {
      ...parseReverseGeocode(payload, latitude, longitude),
      geocodeStatus: payload && payload.status,
      geocodeMessage: String((payload && payload.message) || '')
    };
  } catch (error) {
    console.error('reverse geocode failed', error);
    return {
      ...parseReverseGeocode(null, latitude, longitude),
      geocodeStatus: 'request-failed',
      geocodeMessage: error.message
    };
  }
}

exports.main = async (event = {}) => {
  const latitude = Number(event.latitude);
  const longitude = Number(event.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'invalid-location' };
  }

  const context = cloud.getWXContext();
  const identity = createVisitorIdentity(context.OPENID, context.APPID);
  const location = await reverseGeocode(latitude, longitude);
  const accuracy = Number(event.accuracy);
  const source = event.source === 'location_button' ? 'location_button' : 'page_open';

  await db.collection(VISIT_COLLECTION).add({
    data: {
      visitorId: identity.visitorId,
      visitorCode: identity.visitorCode,
      nation: location.nation,
      province: location.province,
      city: location.city,
      district: location.district,
      street: location.street,
      placeName: location.placeName,
      address: location.address,
      locationLevel: location.locationLevel,
      isShanghai: location.isShanghai,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      source,
      createdAt: db.serverDate()
    }
  });

  return {
    ok: true,
    visitorCode: identity.visitorCode,
    nation: location.nation,
    province: location.province,
    city: location.city,
    district: location.district,
    street: location.street,
    placeName: location.placeName,
    address: location.address,
    locationLevel: location.locationLevel,
    isShanghai: location.isShanghai,
    geocodeStatus: location.geocodeStatus,
    geocodeMessage: location.geocodeMessage
  };
};
