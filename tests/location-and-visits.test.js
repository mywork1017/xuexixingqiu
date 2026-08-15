const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  isRegionOutsideShanghai,
  isWithinShanghaiBounds
} = require('../miniprogram/utils/location-utils');
const {
  createVisitorIdentity,
  parseReverseGeocode
} = require('../cloudfunctions/recordVisit/location');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('上海内外坐标和地图中心按产品范围识别', () => {
  assert.equal(isWithinShanghaiBounds({ latitude: 31.2304, longitude: 121.4737 }), true);
  assert.equal(isWithinShanghaiBounds({ latitude: 39.9042, longitude: 116.4074 }), false);
  assert.equal(isRegionOutsideShanghai({
    southwest: { latitude: 31.1, longitude: 121.3 },
    northeast: { latitude: 31.4, longitude: 121.7 }
  }), false);
  assert.equal(isRegionOutsideShanghai({
    southwest: { latitude: 39.8, longitude: 116.2 },
    northeast: { latitude: 40.0, longitude: 116.6 }
  }), true);
});

test('腾讯逆地址结果提取上海区县并覆盖边界框回退', () => {
  assert.deepEqual(parseReverseGeocode({
    status: 0,
    result: { ad_info: { city: '上海市', district: '浦东新区' } }
  }, 31.22, 121.55), {
    city: '上海市',
    district: '浦东新区',
    isShanghai: true
  });
  assert.equal(parseReverseGeocode({
    status: 0,
    result: { ad_info: { city: '苏州市', district: '昆山市' } }
  }, 31.3, 121.0).isShanghai, false);
});

test('匿名访客编号稳定且不暴露 openid', () => {
  const first = createVisitorIdentity('openid-123', 'appid-456');
  const second = createVisitorIdentity('openid-123', 'appid-456');
  assert.deepEqual(first, second);
  assert.match(first.visitorCode, /^[A-F0-9]{6}$/);
  assert.doesNotMatch(first.visitorId, /openid-123/);
});

test('定位按钮只移动到实时位置且地图外空状态使用上海数据提示', () => {
  const mapJs = read('miniprogram/pages/map/map.js');
  const mapWxml = read('miniprogram/pages/map/map.wxml');
  const moveToLocation = mapJs.match(/moveToUserLocation\(\) \{([\s\S]*?)\n  \},\n\n  openLocation/);
  assert.ok(moveToLocation);
  assert.match(moveToLocation[1], /wx\.getLocation/);
  assert.match(moveToLocation[1], /recordLocationVisit\(location, 'location_button'\)/);
  assert.match(moveToLocation[1], /isShanghai \? userLocation : SHANGHAI_CENTER_LOCATION/);
  assert.doesNotMatch(moveToLocation[1], /\bscale\s*:/);
  assert.match(mapJs, /目前只有上海的图书馆和食堂数据/);
  assert.match(mapWxml, /\{\{emptyStateText\}\}/);
});

test('访问记录云函数和后台页面只保存展示所需定位字段', () => {
  const cloudFunction = read('cloudfunctions/recordVisit/index.js');
  const adminPage = read('admin/app/visits/visits-page-view.tsx');
  assert.match(cloudFunction, /visitorCode: identity\.visitorCode/);
  assert.match(cloudFunction, /district: location\.district/);
  assert.match(cloudFunction, /createdAt: db\.serverDate\(\)/);
  assert.doesNotMatch(cloudFunction, /data:\s*\{[\s\S]*?latitude,[\s\S]*?longitude,[\s\S]*?createdAt:/);
  assert.match(adminPage, /访问时间/);
  assert.match(adminPage, /访客/);
  assert.match(adminPage, /区县/);
});
