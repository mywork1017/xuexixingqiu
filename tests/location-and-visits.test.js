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

test('腾讯逆地址结果按小区地标、街道、区县和城市提取', () => {
  assert.deepEqual(parseReverseGeocode({
    status: 0,
    result: {
      ad_info: { nation: '中国', province: '上海市', city: '上海市', district: '浦东新区' },
      address_component: { street: '世纪大道', street_number: '世纪大道100号' },
      formatted_addresses: { standard_address: '上海市浦东新区世纪大道100号' },
      pois: [{ title: '上海环球金融中心', category: '房产小区:商务楼宇', _distance: 15 }]
    }
  }, 31.22, 121.55), {
    nation: '中国',
    province: '上海市',
    city: '上海市',
    district: '浦东新区',
    street: '世纪大道100号',
    placeName: '上海环球金融中心',
    address: '上海市浦东新区世纪大道100号',
    locationLevel: 'place',
    isShanghai: true
  });
  const outsideShanghai = parseReverseGeocode({
    status: 0,
    result: {
      ad_info: { nation: '中国', province: '北京市', city: '北京市', district: '朝阳区' },
      address_component: { street: '建国路' }
    }
  }, 39.9, 116.4);
  assert.equal(outsideShanghai.city, '北京市');
  assert.equal(outsideShanghai.district, '朝阳区');
  assert.equal(outsideShanghai.locationLevel, 'street');
  assert.equal(outsideShanghai.isShanghai, false);
});

test('匿名访客编号稳定且不暴露 openid', () => {
  const first = createVisitorIdentity('openid-123', 'appid-456');
  const second = createVisitorIdentity('openid-123', 'appid-456');
  assert.deepEqual(first, second);
  assert.match(first.visitorCode, /^[A-F0-9]{6}$/);
  assert.doesNotMatch(first.visitorId, /openid-123/);
});

test('定位按钮只移动到实时位置且附近无数据时仅显示提示', () => {
  const mapJs = read('miniprogram/pages/map/map.js');
  const mapWxml = read('miniprogram/pages/map/map.wxml');
  const appConfig = JSON.parse(read('miniprogram/app.json'));
  const moveToLocation = mapJs.match(/moveToUserLocation\(\) \{([\s\S]*?)\n  \},\n\n  openLocation/);
  assert.ok(moveToLocation);
  assert.match(moveToLocation[1], /this\.getAuthorizedUserLocation\(\)/);
  assert.match(moveToLocation[1], /recordLocationVisit\(location, 'location_button'\)/);
  assert.match(moveToLocation[1], /userLocation,\s*initialSelectionLocation: userLocation/);
  assert.match(moveToLocation[1], /latitude: userLocation\.latitude,\s*longitude: userLocation\.longitude/);
  assert.doesNotMatch(moveToLocation[1], /isShanghai|SHANGHAI_CENTER_LOCATION|当前不在上海/);
  assert.match(moveToLocation[1], /this\.queueUserLocationDrop\(\)/);
  assert.doesNotMatch(moveToLocation[1], /wx\.(?:showLoading|hideLoading)/);
  assert.doesNotMatch(moveToLocation[1], /\bscale\s*:/);
  assert.match(mapJs, /emptyStateText: '附近没有结果'/);
  assert.doesNotMatch(mapWxml, /goToShanghaiCenter|去看看/);
  assert.match(mapWxml, /wx:if="\{\{!noResultsInView\}\}" class="map-actions/);
  assert.match(mapJs, /resolveInitialSelectionLocation\(\)[\s\S]*userLocation,[\s\S]*latitude: userLocation\.latitude,[\s\S]*longitude: userLocation\.longitude/);
  assert.match(mapJs, /requestAuthorizedLocation\('scope\.userLocation', 'getLocation'\)/);
  assert.match(mapJs, /wx\.getSetting/);
  assert.match(mapJs, /wx\.authorize/);
  assert.doesNotMatch(mapJs, /getFuzzyLocation|scope\.userFuzzyLocation/);
  assert.deepEqual(appConfig.requiredPrivateInfos, ['getLocation']);
  assert.equal(appConfig.permission['scope.userFuzzyLocation'], undefined);
});

test('访问记录云函数和后台页面只保存展示所需定位字段', () => {
  const cloudFunction = read('cloudfunctions/recordVisit/index.js');
  const adminPage = read('admin/app/visits/visits-page-view.tsx');
  assert.match(cloudFunction, /visitorCode: identity\.visitorCode/);
  assert.match(cloudFunction, /district: location\.district/);
  assert.match(cloudFunction, /placeName: location\.placeName/);
  assert.match(cloudFunction, /street: location\.street/);
  assert.match(cloudFunction, /createdAt: db\.serverDate\(\)/);
  assert.doesNotMatch(cloudFunction, /data:\s*\{[\s\S]*?latitude,[\s\S]*?longitude,[\s\S]*?createdAt:/);
  assert.match(adminPage, /访问时间/);
  assert.match(adminPage, /访客/);
  assert.match(adminPage, /区县/);
  assert.match(adminPage, /小区\/地标/);
  assert.match(adminPage, /街道/);
  assert.match(adminPage, /搜索访客名字、编号、城市、区县、小区或街道/);
  assert.match(adminPage, /全部地点/);
  assert.match(adminPage, /全部访客/);
  assert.match(adminPage, /DatePicker\.RangePicker/);
  assert.match(adminPage, /saveVisitorName/);
  assert.match(adminPage, /deleteVisit/);
  assert.doesNotMatch(adminPage, /触发方式|定位按钮|打开地图/);
});
