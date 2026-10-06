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
    getApp: () => ({ getNavMetrics: () => ({ topOffset: 50 }) }),
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
      setStorageSync: (key, value) => cache.set(key, value),
      getStorageSync: (key) => cache.get(key),
      nextTick: (callback) => Promise.resolve().then(callback),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
      createMapContext: () => ({ getRegion: ({ success }) => success(bounds) }),
      ...options.wx
    }
  }, { filename: mapFile });
  const page = {
    ...definition,
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
  return { page, updates, cache, requests, timers, timerDelays };
}

const refreshedPlace = { id: 'library', name: '示例图书馆', category: '图书馆', latitude: 31.5, longitude: 121.5 };
const settleRequests = () => new Promise((resolve) => setImmediate(resolve));

function mockLoadingAnimations(page) {
  page.searchFinishes = 0;
  page.startUserLocationSearchSpin = () => { page.userLocationAnimationType = 'search'; };
  page.requestUserLocationSearchFinish = () => { page.searchFinishes += 1; };
  page.queueUserLocationDrop = () => { page.dropQueued = true; };
}

test('刷新范围返回即结束动画，后台分页补齐缓存并保留地图操作', async () => {
  let backgroundRequest;
  const { page, updates, cache, requests, timers, timerDelays } = createRefreshPage((request) => {
    if (request.data.mode === 'bounds') {
      request.success({ result: { data: [{ ...refreshedPlace, address: '新地址' }], hasMore: false } });
    } else backgroundRequest = request;
  });
  page.data.places = [{ ...refreshedPlace, address: '旧地址' }, {
    id: 'outside', name: '范围外地点', category: '自然', latitude: 30, longitude: 120
  }];
  cache.set('places:nature-v4', page.data.places);
  page.data.selectedPlace = page.data.places[0];
  page.data.userLocation = { latitude: 31.2, longitude: 121.3 };
  page.keepInitialUserLocationCenter = true;

  const refresh = page.refreshPlaces();
  assert.equal(page.data.refreshing, true);
  await refresh;

  assert.deepEqual(requests.map((request) => [request.mode, request.offset]), [['bounds', undefined], ['page', 0]]);
  assert.equal(requests[0].limit, 500);
  assert.equal(page.data.syncingPlaces, true);
  assert.equal(page.data.places.length, 2);
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
  page.data.places = originalPlaces;
  page.data.selectedPlace = refreshedPlace;
  cache.set('places:nature-v4', originalPlaces);

  await page.refreshPlaces();
  assert.equal(page.data.places, originalPlaces);
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
  page.data.places = [refreshedPlace];
  page.data.selectedPlace = refreshedPlace;
  await page.refreshPlaces();
  assert.equal(page.data.places.length, 0);
  assert.equal(page.data.markers.length, 0);
  assert.equal(page.data.selectedPlace, null);
  await page.pendingPlaceLoad;
  assert.equal(cache.get('places:nature-v4').length, 0);
  assert.equal(page.data.noResultsInView, true);

  results = [refreshedPlace];
  await page.refreshPlaces();
  assert.equal(page.data.places.length, 1);
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
  assert.equal(page.data.places.length, 1);
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
  page.data.places = [stale, outside];
  page.data.selectedPlace = stale;
  await page.refreshPlaces();
  assert.deepEqual(Array.from(page.data.places, (place) => place.id), ['stale', 'outside', 'library']);
  assert.equal(page.data.selectedPlace.id, 'stale');

  hasMore = false;
  await page.refreshPlaces();
  assert.deepEqual(Array.from(page.data.places, (place) => place.id), ['outside', 'library']);
  assert.equal(page.data.selectedPlace, null);
  assert.equal(requests.filter((request) => request.mode === 'page').length, 1);
  const fullSync = page.pendingPlaceLoad;
  backgroundRequest.success({ result: { data: [stale, outside], hasMore: false } });
  await fullSync;
  assert.deepEqual(Array.from(page.data.places, (place) => place.id), ['outside', 'library']);
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
  assert.equal(page.data.places[0].address, '新地址');
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.refreshRippleVisible, true);
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(cache.get('places:nature-v4')[0].address, '旧地址');
});

test('读取地图范围失败时保留数据并释放刷新状态', async () => {
  const { page, requests } = createRefreshPage(() => {});
  page.data.places = [refreshedPlace];
  page.getCurrentMapRegion = () => Promise.reject(new Error('map unavailable'));
  await page.refreshPlaces();
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.places[0].id, 'library');
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
  assert.equal(page.data.places[0].id, 'library');
  assert.equal(page.data.loading, false);
  await settleRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mode, 'page');
  assert.equal(requests[0].limit, 500);
  assert.equal(page.data.locating, true);

  cloudRequest.success({ result: { data: [{ ...refreshedPlace, address: '最新地址' }] } });
  await settleRequests();
  assert.equal(page.data.syncingPlaces, false);
  assert.equal(page.data.places[0].address, '最新地址');
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
  assert.equal(page.data.places.length, 1);
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
  page.data.places = [refreshedPlace];
  cache.set('places:nature-v4', [refreshedPlace]);
  const complete = page.loadPlaces({ hasCachedPlaces: true });
  assert.equal(page.data.loading, false);
  await complete;
  assert.equal(page.data.places[0].id, 'library');
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
  assert.equal(page.data.places[0].id, 'library');
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
