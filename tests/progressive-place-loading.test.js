const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('地图首页先读本地缓存再等待定位与远程数据', () => {
  const source = read('miniprogram/pages/map/map.js');
  const onLoadStart = source.indexOf('onLoad() {');
  const cacheRead = source.indexOf('const hasCachedPlaces = this.refreshFromCache();', onLoadStart);
  const asyncPreparation = source.indexOf('Promise.all([', onLoadStart);
  assert.ok(cacheRead > onLoadStart);
  assert.ok(cacheRead < asyncPreparation);
  assert.match(source, /wx\.getStorageSync\(PLACES_CACHE_KEY\)/);
  assert.match(source, /writeCache: false/);
});

test('无缓存时先请求地图可视范围，随后分页补齐全量缓存', () => {
  const source = read('miniprogram/pages/map/map.js');
  assert.match(source, /mode: 'bounds', bounds, limit: MAX_VISIBLE_PLACE_COUNT/);
  assert.match(source, /mode: 'page', offset, limit: PLACE_PAGE_SIZE/);
  assert.match(source, /const PLACE_PAGE_SIZE = 200/);
  assert.match(source, /visibleFirst\s*\.then\(\(\) => this\.loadAllPlacePages\(\)\)/);
  assert.match(source, /this\.applyPlaces\(places, '', \{ preserveCenter: true \}\)/);
});

test('远程地点载入期间复用定位小人竖轴旋转动画', () => {
  const source = read('miniprogram/pages/map/map.js');
  assert.match(source, /startPlaceLoadAnimation\(\)[\s\S]*this\.startUserLocationSearchSpin\(\)/);
  assert.match(source, /finishPlaceLoadAnimation\(\)[\s\S]*this\.requestUserLocationSearchFinish\(\)/);
  assert.match(source, /USER_LOCATION_SEARCH_SPIN_DURATION_MS/);
  assert.match(source, /if \(this\.pendingUserLocationDrop\)[\s\S]*this\.finishUserLocationAnimation\(runId\)/);
  assert.match(source, /this\.data\.userLocationIconPath && !animationVisible/);
});

test('地点云函数同时支持边界首批与稳定分页', () => {
  const source = read('cloudfunctions/getPlaces/index.js');
  assert.match(source, /mode === 'bounds'/);
  assert.match(source, /latitude: command\.gte/);
  assert.match(source, /BOUNDS_SCAN_PAGE_SIZE = 1000/);
  assert.match(source, /Number\(place\.longitude\) >= bounds\.southwest\.longitude/);
  assert.match(source, /orderBy\('_id', 'asc'\)/);
  assert.match(source, /nextOffset: offset \+ data\.length/);
});
