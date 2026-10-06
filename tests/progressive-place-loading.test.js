const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function createRefreshPage(callFunction, options = {}) {
  let definition;
  const updates = [];
  const cache = new Map();
  const requests = [];
  const timers = new Map();
  const timerDelays = new Map();
  let timerId = 0;
  const app = { globalData: {}, getNavMetrics: () => ({ topOffset: 50 }) };
  const mapFile = path.join(root, 'miniprogram/pages/map/map.js');
  const pageRequire = createRequire(mapFile);
  const bounds = {
    southwest: { latitude: 31, longitude: 121 },
    northeast: { latitude: 32, longitude: 122 }
  };
  vm.runInNewContext(read('miniprogram/pages/map/map.js'), {
    require: (id) => {
      const module = pageRequire(id);
      return options.drawFrame && id === '../../utils/user-location-icon'
        ? { ...module, drawUserLocationFrameToContext: options.drawFrame } : module;
    },
    Date: options.now ? class extends Date { static now() { return options.now(); } } : Date,
    getApp: () => app,
    Page: (page) => { definition = page; },
    setTimeout: (callback, delay) => {
      timers.set(++timerId, callback);
      timerDelays.set(timerId, delay);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    wx: {
      cloud: {
        callFunction(options) {
          requests.push(options.data);
          callFunction(options);
        }
      },
      setStorageSync: (key, value) => {
        assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1024 * 1024, '模拟手机单键缓存上限');
        cache.set(key, value);
      },
      getStorageSync: (key) => cache.get(key),
      nextTick: (callback) => Promise.resolve().then(callback),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
      createMapContext: () => ({ getRegion: ({ success }) => success(bounds) }),
      ...options.wx
    }
  }, { filename: mapFile });
  const page = {
    ...definition,
    places: [],
    data: {
      ...structuredClone(definition.data),
      latitude: 30.5,
      longitude: 120.5,
      scale: 15,
      loading: false,
      userLocation: { latitude: 31.5, longitude: 121.5 },
      mapDotIconPaths: { 图书馆: '/library.png', 食堂: '/canteen.png' },
      activeFilter: '图书馆',
      activeCategories: ['图书馆']
    },
    setData(update, callback) {
      updates.push(update);
      Object.assign(this.data, update);
      if (callback) callback();
    }
  };
  return { page, updates, cache, requests, timers, timerDelays, app };
}

const refreshedPlace = { id: 'library', name: '示例图书馆', category: '图书馆', latitude: 31.5, longitude: 121.5 };
const settleRequests = () => new Promise((resolve) => setImmediate(resolve));

function mockLoadingAnimations(page) {
  page.searchFinishes = 0;
  page.startUserLocationSearchSpin = () => { page.userLocationAnimationType = 'search'; };
  page.requestUserLocationSearchFinish = () => { page.searchFinishes += 1; };
  page.queueUserLocationDrop = () => { page.dropQueued = true; };
}

const remoteBounds = {
  southwest: { latitude: 30, longitude: 120 },
  northeast: { latitude: 31, longitude: 121 }
};
const remotePlace = { ...refreshedPlace, id: 'remote', name: '远处图书馆', latitude: 30.5, longitude: 120.5 };

function fireVisibleLoad(page, timers) {
  const id = page.visiblePlaceLoadTimer;
  const callback = timers.get(id);
  timers.delete(id);
  callback();
  return settleRequests();
}

test('完整地点超过真机传输上限时仍载入全部地点，拖到远处可直接显示', () => {
  const { page, updates, app, requests } = createRefreshPage(() => {});
  const places = Array.from({ length: 1677 }, (_, index) => ({
    ...(index % 2 ? refreshedPlace : remotePlace),
    id: `place-${index}`,
    description: '地点说明'.repeat(200),
    photos: [`https://example.com/${'photo'.repeat(200)}.jpg`]
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(places)) > 1024 * 1024);
  const setData = page.setData;
  page.setData = function (update, callback) {
    assert.ok(Buffer.byteLength(JSON.stringify(update)) < 1024 * 1024, '模拟真机 setData 传输上限');
    setData.call(this, update, callback);
  };
  page.applyPlaces(places, '', { preserveCenter: true, preserveSelection: true });
  assert.equal(page.places.length, 1677);
  assert.equal(app.globalData.mapPlaces, page.places);
  assert.equal(Object.hasOwn(page.data, 'places'), false);
  assert.ok(updates.every((update) => !Object.hasOwn(update, 'places')));
  page.places = [];
  assert.equal(page.refreshFromCache(), true);
  assert.equal(page.places.length, 1677);
  page.allPlacesLoaded = true;
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  assert.equal(page.data.markers.length, 500);
  assert.ok(page.data.displayPlaces.every((place) => place.latitude === 30.5));
  assert.equal(page.data.noResultsInView, false);
  assert.equal(requests.length, 0);
});

test('手机缓存写入失败仍可显示下载地点并移到远处', () => {
  const { page } = createRefreshPage(() => {}, { wx: { setStorageSync() { throw new Error('storage full'); } } });
  page.applyPlaces([refreshedPlace, remotePlace], '', { preserveCenter: true, preserveSelection: true });
  page.allPlacesLoaded = true;
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  assert.equal(page.places.length, 2);
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['remote']);
  assert.equal(page.data.noResultsInView, false);
});

test('全量同步失败后，真机地图事件按新视野补取地点，加载期间不误报空结果', async () => {
  let visibleRequest;
  const { page, requests, timers, updates, cache } = createRefreshPage((request) => {
    if (request.data.mode === 'page') request.fail(new Error('offline'));
    else visibleRequest = request;
  });
  mockLoadingAnimations(page);
  page.places = [refreshedPlace];
  cache.set('places:nature-v4', page.places);
  await page.loadPlaces({ hasCachedPlaces: true });
  updates.length = 0;
  page.onRegionChange({ type: 'regionchange', detail: { type: 'end', region: remoteBounds } });
  assert.equal(page.data.loadingVisiblePlaces, true);
  assert.equal(page.data.noResultsInView, false);
  await fireVisibleLoad(page, timers);
  assert.equal(requests[1].mode, 'bounds');
  assert.deepEqual(requests[1].bounds, remoteBounds);
  const pending = page.pendingVisiblePlaceLoad;
  visibleRequest.success({ result: { data: [remotePlace], hasMore: false } });
  await pending;
  assert.equal(page.data.loadingVisiblePlaces, false);
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['remote']);
  assert.equal(page.data.noResultsInView, false);
  assert.equal(page.places.length, 2);
  assert.equal(cache.get('places:nature-v4').length, 1);
  assert.equal(updates.some((update) => ['latitude', 'longitude', 'scale'].some((key) => Object.hasOwn(update, key))), false);
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  assert.equal(page.visiblePlaceLoadTimer, null);
});

test('快速连续拖动合并请求，旧区域延迟结果不会覆盖当前视野', async () => {
  const pendingRequests = [];
  const { page, timers, requests } = createRefreshPage((request) => pendingRequests.push(request));
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  assert.equal(timers.size, 1);
  await fireVisibleLoad(page, timers);
  const oldLoad = page.pendingVisiblePlaceLoad;
  page.onRegionChange({ type: 'begin' });
  const newBounds = { southwest: { latitude: 31, longitude: 121 }, northeast: { latitude: 32, longitude: 122 } };
  page.onRegionChange({ type: 'end', detail: { region: newBounds } });
  await fireVisibleLoad(page, timers);
  const newLoad = page.pendingVisiblePlaceLoad;
  pendingRequests[0].success({ result: { data: [remotePlace], hasMore: false } });
  await oldLoad;
  assert.equal(page.places.length, 0);
  assert.equal(page.data.loadingVisiblePlaces, true);
  assert.equal(page.data.noResultsInView, false);
  pendingRequests[1].success({ result: { data: [refreshedPlace], hasMore: false } });
  await newLoad;
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['library']);
  assert.equal(requests.length, 2);
});

test('区域加载失败显示错误并允许重试，确认空区域后才显示空结果', async () => {
  let pendingRequest;
  const { page, timers } = createRefreshPage((request) => { pendingRequest = request; });
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  await fireVisibleLoad(page, timers);
  const failedLoad = page.pendingVisiblePlaceLoad;
  pendingRequest.fail(new Error('offline'));
  await failedLoad;
  assert.equal(page.data.noResultsInView, false);
  assert.equal(page.data.loadError, '地点加载失败，请稍后重试');
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  await fireVisibleLoad(page, timers);
  const retry = page.pendingVisiblePlaceLoad;
  pendingRequest.success({ result: { data: [], hasMore: false } });
  await retry;
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.noResultsInView, true);
});

test('页面隐藏取消区域加载，晚到的响应不会改动地点', async () => {
  let pendingRequest;
  const { page, timers } = createRefreshPage((request) => { pendingRequest = request; });
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  await fireVisibleLoad(page, timers);
  const pending = page.pendingVisiblePlaceLoad;
  page.onHide();
  pendingRequest.success({ result: { data: [remotePlace], hasMore: false } });
  await pending;
  assert.equal(page.places.length, 0);
  assert.equal(page.data.loadingVisiblePlaces, false);
});

test('首批附近请求与旧全量结果晚到时，保留拖动后新区域的地点', async () => {
  const pending = [];
  const { page, timers } = createRefreshPage((request) => pending.push(request));
  mockLoadingAnimations(page);
  const startup = page.loadPlaces();
  await settleRequests();
  const nearbyRequest = pending[0];
  page.onRegionChange({ type: 'end', detail: { region: remoteBounds } });
  await fireVisibleLoad(page, timers);
  const visibleLoad = page.pendingVisiblePlaceLoad;
  pending[1].success({ result: { data: [remotePlace], hasMore: false } });
  await visibleLoad;
  nearbyRequest.success({ result: { data: [refreshedPlace], hasMore: false } });
  await settleRequests();
  assert.equal(page.places.length, 2);
  pending[2].success({ result: { data: [refreshedPlace], hasMore: false } });
  await startup;
  assert.equal(page.places.length, 2);
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['remote']);
});

test('地图新加载地点在完整缓存同步前即可打开详情，详情不传输整份地点', async () => {
  let definition;
  const file = path.join(root, 'miniprogram/pages/detail/detail.js');
  const detailRequire = createRequire(file);
  const app = { globalData: { mapPlaces: [remotePlace, { ...remotePlace, id: 'neighbor', name: '相邻图书馆' }] }, getNavMetrics: () => ({}) };
  vm.runInNewContext(read('miniprogram/pages/detail/detail.js'), {
    require: (id) => id === '../../utils/map-dot-icon' ? { drawMapDotIcon: () => Promise.resolve('/library.png') } : detailRequire(id),
    getApp: () => app,
    Page: (page) => { definition = page; },
    wx: { getStorageSync: () => [refreshedPlace], showToast: () => assert.fail('会话里的地点应能打开') }
  }, { filename: file });
  const page = { ...definition, data: structuredClone(definition.data), setData(update, callback) {
    assert.equal(Object.hasOwn(update, 'allPlaces'), false);
    Object.assign(this.data, update);
    if (callback) callback();
  } };
  page.onLoad({ id: 'remote' });
  await settleRequests();
  assert.equal(page.data.place.id, 'remote');
  assert.equal(page.data.nearbyPlaces[0].id, 'neighbor');
  assert.equal(page.allPlaces.length, 2);
});

test('刷新范围返回即结束动画，后台分页补齐缓存并保留地图操作', async () => {
  let backgroundRequest;
  const { page, updates, cache, requests, timers, timerDelays } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') {
      request.success({ result: { data: [{ ...refreshedPlace, address: '新地址' }], hasMore: false } });
    } else backgroundRequest = request;
  });
  page.places = [{ ...refreshedPlace, address: '旧地址' }, {
    id: 'outside', name: '范围外地点', category: '自然', latitude: 30, longitude: 120
  }];
  cache.set('places:nature-v4', page.places);
  page.data.selectedPlace = page.places[0];
  page.data.userLocation = { latitude: 31.2, longitude: 121.3 };
  page.keepInitialUserLocationCenter = true;

  const refresh = page.refreshPlaces();
  assert.equal(page.data.refreshing, true);
  await refresh;

  assert.deepEqual(requests.map((request) => [request.mode, request.offset]), [['bounds', undefined], ['page', 0]]);
  assert.equal(requests[0].limit, 500);
  assert.equal(page.data.syncingPlaces, true);
  assert.equal(page.places.length, 2);
  assert.equal(page.data.selectedPlace.id, 'library');
  assert.equal(page.data.selectedPlace.address, '新地址');
  assert.equal(page.data.activeFilter, '图书馆');
  assert.deepEqual(page.data.activeCategories, ['图书馆']);
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['library']);
  assert.equal(cache.get('places:nature-v4')[0].address, '旧地址');
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.refreshRippleVisible, true);
  assert.ok(Math.abs(page.data.refreshRippleX - 112.5) < 0.00001);
  const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
  const expectedY = (mercatorY(32) - mercatorY(31.2)) / (mercatorY(32) - mercatorY(31)) * 667;
  assert.ok(Math.abs(page.data.refreshRippleY - expectedY) < 0.00001);
  const fullSync = page.pendingPlaceLoad;
  backgroundRequest.success({ result: { data: [{ ...refreshedPlace, address: '旧后台结果' }], hasMore: true, nextOffset: 1 } });
  await settleRequests();
  backgroundRequest.success({ result: { data: [{ id: 'outside', name: '范围外地点', category: '自然', latitude: 30, longitude: 120 }], hasMore: false } });
  await fullSync;
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(cache.get('places:nature-v4').length, 2);
  assert.equal(cache.get('places:nature-v4').find((place) => place.id === 'library').address, '新地址');
  const finishRipple = timers.get(page.refreshRippleTimer);
  assert.equal(timerDelays.get(page.refreshRippleTimer), 1500);
  finishRipple();
  assert.equal(page.data.refreshRippleVisible, false);
  for (const update of updates) {
    for (const key of ['latitude', 'longitude', 'scale', 'userLocation']) {
      assert.equal(Object.hasOwn(update, key), false, `刷新不能重新绑定 ${key}`);
    }
  }
});

test('刷新失败保留原数据与缓存，释放刷新状态并允许重试', async () => {
  let failRequest = true;
  const { page, cache } = createRefreshPage(({ success, fail }) => {
    if (failRequest) fail(new Error('offline'));
    else success({ result: { data: [refreshedPlace], hasMore: false } });
  });
  const originalPlaces = [refreshedPlace];
  page.places = originalPlaces;
  page.data.selectedPlace = refreshedPlace;
  cache.set('places:nature-v4', originalPlaces);

  await page.refreshPlaces();
  assert.equal(page.places, originalPlaces);
  assert.equal(cache.get('places:nature-v4'), originalPlaces);
  assert.equal(page.data.selectedPlace, refreshedPlace);
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.loadError, '刷新失败，请稍后重试');
  assert.equal(page.data.refreshRippleVisible, false);

  failRequest = false;
  await page.refreshPlaces();
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.refreshRippleVisible, true);
});

test('刷新空范围清除范围内旧点位与卡片，完整同步后更新缓存', async () => {
  let results = [];
  const { page, cache } = createRefreshPage(({ success }) => success({ result: { data: results, hasMore: false } }));
  page.places = [refreshedPlace];
  page.data.selectedPlace = refreshedPlace;
  await page.refreshPlaces();
  assert.equal(page.places.length, 0);
  assert.equal(page.data.markers.length, 0);
  assert.equal(page.data.selectedPlace, null);
  await page.pendingPlaceLoad;
  assert.equal(cache.get('places:nature-v4').length, 0);
  assert.equal(page.data.noResultsInView, true);

  results = [refreshedPlace];
  await page.refreshPlaces();
  assert.equal(page.places.length, 1);
  assert.equal(page.data.selectedPlace, null);
  assert.equal(page.data.noResultsInView, false);
});

test('首页载入和刷新期间阻止重复请求', async () => {
  let pending;
  const { page, requests } = createRefreshPage((options) => { pending = options; });
  page.data.loading = true;
  assert.equal(page.refreshPlaces(), undefined);
  assert.equal(requests.length, 0);
  page.data.loading = false;

  const refresh = page.refreshPlaces();
  assert.equal(page.refreshPlaces(), undefined);
  await settleRequests();
  assert.equal(requests.length, 1);
  pending.success({ result: { data: [refreshedPlace], hasMore: false } });
  await refresh;
  pending.success({ result: { data: [refreshedPlace], hasMore: false } });
  await page.pendingPlaceLoad;
  assert.equal(page.data.refreshing, false);
});

test('没有用户定位时正常刷新数据，波纹保持隐藏', async () => {
  const { page, timers } = createRefreshPage(({ success }) => success({ result: { data: [refreshedPlace], hasMore: false } }));
  page.data.userLocation = null;
  await page.refreshPlaces();
  assert.equal(page.places.length, 1);
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.refreshRippleVisible, false);
  assert.equal(timers.size, 0);
});

test('取消波纹后，延迟返回的地图范围不会重新显示动画', async () => {
  const { page, timers } = createRefreshPage(() => {});
  let resolveRegion;
  page.getCurrentMapRegion = () => new Promise((resolve) => { resolveRegion = resolve; });
  const animation = page.playRefreshRipple();
  page.stopRefreshRipple();
  resolveRegion({
    southwest: { latitude: 31, longitude: 121 },
    northeast: { latitude: 32, longitude: 122 }
  });
  await animation;
  assert.equal(page.data.refreshRippleVisible, false);
  assert.equal(timers.size, 0);
});

test('范围结果截断时保留未返回旧点位，完整结果删除旧点位且保留范围外数据', async () => {
  let hasMore = true;
  let backgroundRequest;
  const { page, requests } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') request.success({ result: { data: [refreshedPlace], hasMore } });
    else backgroundRequest = request;
  });
  const stale = { ...refreshedPlace, id: 'stale' };
  const outside = { ...refreshedPlace, id: 'outside', latitude: 30 };
  page.places = [stale, outside];
  page.data.selectedPlace = stale;
  await page.refreshPlaces();
  assert.deepEqual(Array.from(page.places, (place) => place.id), ['stale', 'outside', 'library']);
  assert.equal(page.data.selectedPlace.id, 'stale');

  hasMore = false;
  await page.refreshPlaces();
  assert.deepEqual(Array.from(page.places, (place) => place.id), ['outside', 'library']);
  assert.equal(page.data.selectedPlace, null);
  assert.equal(requests.filter((request) => request.mode === 'page').length, 1);
  const fullSync = page.pendingPlaceLoad;
  backgroundRequest.success({ result: { data: [stale, outside], hasMore: false } });
  await fullSync;
  assert.deepEqual(Array.from(page.places, (place) => place.id), ['outside', 'library']);
});

test('后台同步失败保留已成功刷新的范围结果与旧完整缓存', async () => {
  let backgroundRequest;
  const { page, cache } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') request.success({ result: {
      data: [{ ...refreshedPlace, address: '新地址' }], hasMore: false
    } });
    else backgroundRequest = request;
  });
  cache.set('places:nature-v4', [{ ...refreshedPlace, address: '旧地址' }]);
  await page.refreshPlaces();
  const fullSync = page.pendingPlaceLoad;
  backgroundRequest.fail(new Error('background unavailable'));
  await fullSync;
  assert.equal(page.places[0].address, '新地址');
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.refreshRippleVisible, true);
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(cache.get('places:nature-v4')[0].address, '旧地址');
});

test('读取地图范围失败时保留数据并释放刷新状态', async () => {
  const { page, requests } = createRefreshPage(() => {});
  page.places = [refreshedPlace];
  page.getCurrentMapRegion = () => Promise.reject(new Error('map unavailable'));
  await page.refreshPlaces();
  assert.equal(page.data.refreshing, false);
  assert.equal(page.places[0].id, 'library');
  assert.equal(page.data.loadError, '刷新失败，请稍后重试');
  assert.equal(requests.length, 0);
});

test('首页缓存立即可用，地点请求不等待定位与图标准备', async () => {
  let cloudRequest;
  let resolveLocation;
  let resolveMapIcons;
  let resolveUserIcon;
  const { page, cache, requests } = createRefreshPage((request) => { cloudRequest = request; });
  mockLoadingAnimations(page);
  cache.set('places:nature-v4', [refreshedPlace]);
  page.getAuthorizedUserLocation = () => new Promise((resolve) => { resolveLocation = resolve; });
  page.recordLocationVisit = () => Promise.resolve({});
  page.prepareMapDotIcons = () => new Promise((resolve) => { resolveMapIcons = resolve; });
  page.prepareUserLocationIcons = () => new Promise((resolve) => { resolveUserIcon = resolve; });
  const startup = page.onLoad();
  assert.equal(page.places[0].id, 'library');
  assert.equal(page.data.loading, false);
  await settleRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mode, 'page');
  assert.equal(requests[0].limit, 500);
  assert.equal(page.data.locating, true);

  cloudRequest.success({ result: { data: [{ ...refreshedPlace, address: '最新地址' }] } });
  await settleRequests();
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(page.places[0].address, '最新地址');
  assert.equal(page.data.locating, true);
  assert.equal(page.searchFinishes, 0);

  resolveLocation({ latitude: 31.6, longitude: 121.7 });
  resolveMapIcons();
  resolveUserIcon();
  await startup;
  assert.equal(page.data.locating, false);
  assert.equal(page.data.latitude, 31.6);
  assert.equal(page.data.longitude, 121.7);
  assert.equal(page.searchFinishes, 1);
});

test('首批数据解除加载，刷新范围不等待已有全量同步', async () => {
  let visibleRequest;
  let allRequest;
  const { page, cache, requests, updates } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') visibleRequest = request;
    else allRequest = request;
  });
  mockLoadingAnimations(page);
  const complete = page.loadPlaces();
  assert.equal(page.data.loading, true);
  await settleRequests();
  visibleRequest.success({ result: { data: [refreshedPlace], hasMore: false } });
  await settleRequests();
  assert.equal(page.places.length, 1);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.syncingPlaces, true);
  assert.equal(page.searchFinishes, 1);
  assert.equal(cache.has('places:nature-v4'), false);
  assert.equal(allRequest.data.limit, 500);

  page.data.latitude = 31.7;
  page.data.longitude = 121.8;
  page.data.scale = 16;
  page.data.activeFilter = '自然';
  page.data.activeCategories = ['自然'];
  page.data.selectedPlace = null;
  updates.length = 0;
  const refresh = page.refreshPlaces();
  await settleRequests();
  assert.equal(requests.length, 3);
  visibleRequest.success({ result: { data: [refreshedPlace, {
    id: 'park', name: '示例公园', category: '自然', latitude: 31.5, longitude: 121.6
  }], hasMore: false } });
  await refresh;
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.syncingPlaces, true);
  assert.equal(requests.length, 3);
  allRequest.success({ result: { data: [refreshedPlace, {
    id: 'park', name: '示例公园', category: '自然', latitude: 31.5, longitude: 121.6
  }] } });
  await Promise.all([complete, refresh]);
  assert.equal(cache.get('places:nature-v4').length, 2);
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.selectedPlace, null);
  assert.equal(page.data.activeFilter, '自然');
  assert.deepEqual(Array.from(page.data.displayPlaces, (place) => place.id), ['park']);
  for (const update of updates) {
    for (const key of ['latitude', 'longitude', 'scale']) {
      assert.equal(Object.hasOwn(update, key), false, `后台同步不能重新绑定 ${key}`);
    }
  }
});

test('定位结果立即移动地图，地点旋转与未完成的访问记录不阻塞操作', async () => {
  const { page } = createRefreshPage(() => {});
  mockLoadingAnimations(page);
  page.userLocationAnimationType = 'search';
  page.data.loading = true;
  let recordedSource;
  page.getAuthorizedUserLocation = () => Promise.resolve({ latitude: 31.7, longitude: 121.8 });
  page.recordLocationVisit = (location, source) => {
    recordedSource = source;
    return new Promise(() => {});
  };
  const locationRequest = page.moveToUserLocation();
  assert.ok(locationRequest);
  assert.equal(page.data.locating, true);
  assert.equal(page.moveToUserLocation(), undefined);
  await locationRequest;
  assert.equal(page.data.latitude, 31.7);
  assert.equal(page.data.longitude, 121.8);
  assert.equal(page.data.scale, 15);
  assert.equal(page.data.locating, false);
  assert.equal(page.dropQueued, true);
  assert.equal(recordedSource, 'location_button');
});

test('访问记录失败不改变成功的定位结果', async () => {
  const { page } = createRefreshPage(() => {});
  mockLoadingAnimations(page);
  page.getAuthorizedUserLocation = () => Promise.resolve({ latitude: 31.7, longitude: 121.8 });
  page.recordLocationVisit = () => Promise.reject(new Error('visit unavailable'));
  await page.moveToUserLocation();
  assert.equal(page.data.latitude, 31.7);
  assert.equal(page.data.longitude, 121.8);
  assert.equal(page.data.locating, false);
  assert.equal(page.dropQueued, true);
});

test('快速定位与画布延迟就绪时仍完整旋转一圈、落地并恢复静止小人', async () => {
  let now = 100000;
  let firstCanvasResult;
  let queries = 0;
  let frameId = 0;
  const frames = [];
  const animationFrames = new Map();
  const cleared = [];
  const context = {
    scale() {}, save() {}, restore() {}, translate() {},
    clearRect(...args) { cleared.push(args); }
  };
  const canvas = {
    getContext: () => context,
    requestAnimationFrame(callback) { animationFrames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => animationFrames.delete(id)
  };
  const { page, timers } = createRefreshPage(() => {}, {
    now: () => now,
    drawFrame: (unused, frame) => frames.push({ ...frame }),
    wx: {
      createSelectorQuery() {
        const query = {
          in: () => query,
          select: () => query,
          fields: () => query,
          exec(callback) {
            queries += 1;
            if (queries === 1) firstCanvasResult = callback;
            else callback([{ node: canvas }]);
          }
        };
        return query;
      }
    }
  });
  page.data.userLocationIconPath = '/person.png';
  page.userLocationSearchStartedAt = 1000;
  page.getAuthorizedUserLocation = () => Promise.resolve({ latitude: 31.7, longitude: 121.8 });
  page.recordLocationVisit = () => new Promise(() => {});
  const stepFrame = (time) => {
    now = time;
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    callbacks.forEach((callback) => callback());
  };

  await page.moveToUserLocation();
  assert.equal(page.data.latitude, 31.7);
  assert.equal(page.data.locating, false);
  assert.equal(page.userLocationSearchStartedAt, null);
  assert.equal(page.userLocationSearchFinishAt, 720);
  assert.equal(page.pendingUserLocationDrop, true);
  firstCanvasResult([]);
  await settleRequests();
  assert.equal(queries, 2);
  assert.equal(canvas.width, 375);
  assert.equal(canvas.height, 667);
  assert.deepEqual(cleared.at(-1), [0, 0, 375, 667]);
  assert.equal(page.data.userLocationAnimationVisible, true);
  assert.equal(page.userLocationSearchFinishAt, 720);

  stepFrame(100360);
  assert.equal(frames.at(-1).spinYRotation, 180);
  assert.equal(frames.at(-1).alpha, 1);
  const ready = timers.get(page.userLocationDropStartTimer);
  ready();
  assert.equal(page.userLocationAnimationType, 'search');
  stepFrame(100720);
  assert.equal(page.userLocationAnimationType, 'drop');
  assert.equal(page.pendingUserLocationDrop, false);
  assert.equal(page.data.userLocationAnimationVisible, true);
  stepFrame(101720);
  assert.equal(page.userLocationAnimationType, null);
  assert.equal(page.data.userLocationAnimationVisible, false);
  assert.equal(page.data.markers.filter((marker) => marker.markerType === 'user-location').length, 1);
  assert.equal(page.data.markers[0].alpha, 1);
});

test('画布持续不可用时释放落地等待，后续定位仍可重新尝试', async () => {
  const { page, timers } = createRefreshPage(() => {});
  const applyData = page.setData;
  page.setData = function setData(update, callback) {
    applyData.call(this, update, update.locating === true ? undefined : callback);
  };
  page.ensureUserLocationAnimationCanvas = (callback) => callback(null, null);
  let requests = 0;
  page.getAuthorizedUserLocation = () => {
    requests += 1;
    return Promise.resolve({ latitude: 31.7, longitude: 121.8 });
  };
  page.recordLocationVisit = () => Promise.resolve({});
  await page.moveToUserLocation();
  timers.get(page.userLocationDropStartTimer)();
  assert.equal(page.pendingUserLocationDrop, false);
  assert.equal(page.data.userLocationAnimationVisible, false);
  assert.equal(page.data.locating, false);
  await page.moveToUserLocation();
  assert.equal(requests, 2);
});

test('后台全量同步失败保留可用缓存并释放同步状态', async () => {
  const { page, cache } = createRefreshPage(({ fail }) => fail(new Error('offline')));
  mockLoadingAnimations(page);
  page.places = [refreshedPlace];
  cache.set('places:nature-v4', [refreshedPlace]);
  const complete = page.loadPlaces({ hasCachedPlaces: true });
  assert.equal(page.data.loading, false);
  await complete;
  assert.equal(page.places[0].id, 'library');
  assert.equal(cache.get('places:nature-v4')[0].id, 'library');
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(page.pendingPlaceLoad, null);
});

test('范围首批失败时由全量请求恢复地点并结束加载', async () => {
  let allRequest;
  const { page } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') request.fail(new Error('bounds unavailable'));
    else allRequest = request;
  });
  mockLoadingAnimations(page);
  const complete = page.loadPlaces();
  await settleRequests();
  assert.equal(page.data.loading, true);
  allRequest.success({ result: { data: [refreshedPlace], hasMore: false } });
  await complete;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(page.places[0].id, 'library');
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
  assert.match(source, /longitude: command\.gte/);
  assert.match(source, /limit\(limit \+ 1\)/);
  assert.match(source, /hasMore: data\.length > limit/);
  assert.match(source, /orderBy\('_id', 'asc'\)/);
  assert.match(source, /nextOffset: offset \+ data\.length/);
});
