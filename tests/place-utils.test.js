const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  filterPlaces,
  filterPlacesByCategories,
  getActiveCategoriesForFilter,
  getBoundsInsideVerticalOverlays,
  getDisplayPlaces,
  getDefaultSelectedPlace,
  getPlaceDisplayAddress,
  getPlaceDisplayHours,
  getPlaceNavigationLabel,
  getPlaceDisplayPhotos,
  getPlaceVisualMeta,
  getNearbyPlaces,
  getDistanceText,
  isExcludedPlaceType,
  normalizeCategoryIconPaths,
  orderPlacesByProximity,
  placesToMarkers,
  normalizePlace,
  sanitizePlaceDescription
} = require('../miniprogram/utils/place-utils');

test('CATEGORY_OPTIONS contains the two supported place categories in product order', () => {
  assert.deepEqual(CATEGORY_OPTIONS, [
    '图书馆',
    '食堂'
  ]);
});

test('CATEGORY_FILTER_OPTIONS starts with 全部 before place categories', () => {
  assert.deepEqual(CATEGORY_FILTER_OPTIONS, [
    '全部',
    '图书馆',
    '食堂'
  ]);
});

test('getActiveCategoriesForFilter maps 全部 and single category choices', () => {
  assert.deepEqual(getActiveCategoriesForFilter('全部'), CATEGORY_OPTIONS);
  assert.deepEqual(getActiveCategoriesForFilter('书店'), CATEGORY_OPTIONS);
  assert.deepEqual(getActiveCategoriesForFilter('不存在'), CATEGORY_OPTIONS);
});

test('filterPlaces returns all places for 全部 and only matching places for a category', () => {
  const places = [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '浦东新区党群服务中心', category: '图书馆' },
    { name: '静安社区食堂', category: '食堂' }
  ];

  assert.equal(filterPlaces(places, '全部').length, 2);
  assert.deepEqual(filterPlaces(places, '图书馆'), [
    { name: '徐家汇书院', category: '图书馆' }
  ]);
});

test('filterPlacesByCategories supports compact multi-select filtering', () => {
  const places = [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '闵行城市书房', category: '图书馆' },
    { name: '静安社区食堂', category: '食堂' }
  ];

  assert.deepEqual(filterPlacesByCategories(places, ['图书馆', '食堂']), [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '静安社区食堂', category: '食堂' }
  ]);
  assert.equal(filterPlacesByCategories(places, []).length, 0);
});

test('normalizePlace converts coordinates to numbers and preserves searchable fields', () => {
  const place = normalizePlace({
    _id: 'p1',
    name: '上海图书馆东馆',
    category: '图书馆',
    latitude: '31.2039',
    longitude: '121.5504',
    updatedAt: '2026-06-19'
  });

  assert.equal(place.latitude, 31.2039);
  assert.equal(place.longitude, 121.5504);
  assert.equal(place.id, 'p1');
});

test('legacy categories are left unsupported', () => {
  const place = normalizePlace({
    _id: 'p2',
    name: '浦东新区党群服务中心',
    category: '党群服务中心',
    latitude: 31.2,
    longitude: 121.5
  });

  assert.equal(place.category, '党群服务中心');
  assert.equal(normalizePlace({
    name: '静安社区食堂',
    category: '社区食堂',
    latitude: 31.2,
    longitude: 121.5
  }).category, '社区食堂');
  assert.deepEqual(normalizeCategoryIconPaths({
    党群服务中心: 'tmp/party-dot.png',
    社区食堂: 'tmp/community-canteen-dot.png'
  }), {
    党群服务中心: 'tmp/party-dot.png',
    社区食堂: 'tmp/community-canteen-dot.png'
  });
});

test('excluded place names are recognized by runtime filters', () => {
  for (const name of [
    '浦东新区党群服务中心',
    '科技党建服务站',
    '闵行城市书房',
    '阅闲坊',
    '七棵树微型阅读空间',
    '曹家渡街道达安星之会所图书室',
    '公共流动图书车借阅点'
  ]) {
    assert.equal(isExcludedPlaceType(name), true);
  }
  assert.equal(isExcludedPlaceType('徐家汇书院'), false);
  assert.equal(isExcludedPlaceType('枫林党群服务中心图书馆'), false);
});

test('placesToMarkers maps places into stable WeChat map marker objects with generated dot paths', () => {
  const markers = placesToMarkers([
    {
      id: 'p1',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504,
      address: '上海市浦东新区合欢路300号'
    }
  ], { mapDotIconPaths: { 图书馆: 'tmp/library-dot.png' } });

  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, 1);
  assert.equal(markers[0].placeId, 'p1');
  assert.equal(markers[0].latitude, 31.2039);
  assert.equal(markers[0].iconPath, 'tmp/library-dot.png');
  assert.equal(markers[0].width, 22);
  assert.equal(markers[0].height, 22);
  assert.equal(markers[0].label, undefined);
  assert.equal(markers[0].callout, undefined);
});

test('placesToMarkers makes the selected place visibly larger', () => {
  const markers = placesToMarkers([
    {
      id: 'p1',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    },
    {
      id: 'p2',
      name: '斜土路街道社区食堂',
      category: '食堂',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ], {
    selectedPlaceId: 'p2',
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      食堂: 'tmp/canteen-dot.png'
    },
    selectedMapDotIconPaths: {
      图书馆: 'tmp/selected-library-dot.png',
      食堂: 'tmp/selected-canteen-dot.png'
    }
  });

  const normalDot = markers.find((marker) => marker.placeId === 'p1' && marker.markerType === 'dot');
  const selectedDot = markers.find((marker) => marker.placeId === 'p2' && marker.markerType === 'dot');

  assert.equal(markers[0].width, 22);
  assert.equal(markers.length, 2);
  assert.equal(normalDot.iconPath, 'tmp/library-dot.png');
  assert.equal(selectedDot.iconPath, 'tmp/selected-canteen-dot.png');
  assert.equal(selectedDot.width, 39);
  assert.equal(selectedDot.height, 39);
  assert.equal(selectedDot.alpha, 1);
  assert.equal(selectedDot.label, undefined);
  assert.ok(selectedDot.zIndex > normalDot.zIndex);
  assert.equal(selectedDot.zIndex, 999);
});

test('placesToMarkers places the selected dot last without a bubble', () => {
  const markers = placesToMarkers([
    {
      id: 'p1',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    },
    {
      id: 'p2',
      name: '斜土路街道社区食堂',
      category: '食堂',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ], {
    selectedPlaceId: 'p1',
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      食堂: 'tmp/canteen-dot.png'
    },
    selectedMapDotIconPath: 'tmp/selected-brand-dot.png'
  });

  assert.equal(markers.length, 2);
  assert.equal(markers.at(-1).markerType, 'dot');
  assert.equal(markers.at(-1).placeId, 'p1');
  assert.equal(markers.at(-1).iconPath, 'tmp/selected-brand-dot.png');
  assert.equal(markers.at(-1).title, undefined);
  assert.equal(markers.at(-1).callout, undefined);
  assert.ok(markers.at(-1).zIndex > markers.find((marker) => marker.placeId === 'p2').zIndex);
});

test('sanitizePlaceDescription keeps reviewed description wording', () => {
  assert.equal(
    sanitizePlaceDescription('环境安静宽敞、采光好，提供开水和 WiFi，有卫生间，插座数量有限，适合自习'),
    '环境安静宽敞、采光好，提供开水和 WiFi，有卫生间，插座数量有限，适合自习'
  );
  assert.equal(sanitizePlaceDescription('无热水，不提供充电，有蹲厕'), '无热水，不提供充电，有蹲厕');
  assert.equal(sanitizePlaceDescription('人多拥挤，有些吵闹，无无线网络'), '人多拥挤，有些吵闹，无无线网络');
});

test('sanitizePlaceDescription removes only trailing punctuation and extra whitespace', () => {
  assert.equal(
    sanitizePlaceDescription('用餐环境整洁，座位数量有限，晚餐时段可能拥挤。'),
    '用餐环境整洁，座位数量有限，晚餐时段可能拥挤'
  );
  assert.equal(
    sanitizePlaceDescription('馆内部分区域设有插座，偶有楼外声音传入，座位够用。'),
    '馆内部分区域设有插座，偶有楼外声音传入，座位够用'
  );
  assert.equal(sanitizePlaceDescription('  位于三楼，配有 Wi-Fi；  '), '位于三楼，配有 Wi-Fi');
  assert.equal(sanitizePlaceDescription(''), '');
});

test('placesToMarkers restores unselected places to their original layer order', () => {
  const places = [
    {
      id: 'library',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    },
    {
      id: 'service',
      name: '徐汇图书馆分馆',
      category: '图书馆',
      latitude: 31.2042,
      longitude: 121.4462
    },
    {
      id: 'canteen',
      name: '斜土路街道社区食堂',
      category: '食堂',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ];
  const firstSelection = placesToMarkers(places, {
    selectedPlaceId: 'library',
    allPlaceIds: places.map((place) => place.id),
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      食堂: 'tmp/canteen-dot.png'
    }
  });
  const secondSelection = placesToMarkers(places, {
    selectedPlaceId: 'canteen',
    allPlaceIds: places.map((place) => place.id),
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      食堂: 'tmp/canteen-dot.png'
    }
  });

  assert.ok(
    firstSelection.find((marker) => marker.placeId === 'library' && marker.markerType === 'dot').zIndex
      > firstSelection.find((marker) => marker.placeId === 'canteen' && marker.markerType === 'dot').zIndex
  );
  assert.deepEqual(
    secondSelection
      .filter((marker) => marker.markerType === 'dot')
      .map((marker) => marker.placeId),
    ['library', 'service', 'canteen']
  );
  assert.ok(
    secondSelection.find((marker) => marker.placeId === 'library' && marker.markerType === 'dot').zIndex
      < secondSelection.find((marker) => marker.placeId === 'canteen' && marker.markerType === 'dot').zIndex
  );
});

test('orderPlacesByProximity keeps both swipe directions near the selected anchor', () => {
  const places = [
    { id: 'far-east', category: '图书馆', latitude: 31.23, longitude: 121.57 },
    { id: 'near-west', category: '图书馆', latitude: 31.23, longitude: 121.469 },
    { id: 'anchor', category: '图书馆', latitude: 31.23, longitude: 121.47 },
    { id: 'far-west', category: '图书馆', latitude: 31.23, longitude: 121.37 },
    { id: 'near-east', category: '图书馆', latitude: 31.23, longitude: 121.471 }
  ];

  const ordered = orderPlacesByProximity(places, places[2]);

  assert.equal(ordered[0].id, 'anchor');
  assert.deepEqual(new Set([ordered[1].id, ordered.at(-1).id]), new Set(['near-east', 'near-west']));
});

test('getBoundsInsideVerticalOverlays removes areas hidden by filters and card', () => {
  const bounds = {
    southwest: { latitude: 31.1, longitude: 121.4 },
    northeast: { latitude: 31.3, longitude: 121.7 }
  };

  const visibleBounds = getBoundsInsideVerticalOverlays(bounds, 0.2, 0.25);
  assert.ok(Math.abs(visibleBounds.southwest.latitude - 31.15) < 0.000001);
  assert.equal(visibleBounds.southwest.longitude, 121.4);
  assert.ok(Math.abs(visibleBounds.northeast.latitude - 31.26) < 0.000001);
  assert.equal(visibleBounds.northeast.longitude, 121.7);
});

test('getDefaultSelectedPlace chooses a visible place in the active filter', () => {
  const places = [
    {
      id: 'library',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    },
    {
      id: 'canteen',
      name: '斜土路街道社区食堂',
      category: '食堂',
      latitude: 31.1931,
      longitude: 121.4342
    },
    {
      id: 'far-canteen',
      name: '远处社区食堂',
      category: '食堂',
      latitude: 31.9,
      longitude: 122.1
    }
  ];
  const bounds = {
    southwest: { latitude: 31.18, longitude: 121.42 },
    northeast: { latitude: 31.21, longitude: 121.45 }
  };

  assert.equal(getDefaultSelectedPlace(places, {
    categories: ['食堂'],
    bounds,
    scale: 12,
    origin: places[0]
  }).id, 'canteen');

  assert.equal(getDefaultSelectedPlace(places, {
    categories: ['书店'],
    bounds,
    scale: 12,
    origin: places[0]
  }), null);
});

test('getDefaultSelectedPlace falls back to a matching category when current bounds are empty', () => {
  const places = [
    {
      id: 'library',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    },
    {
      id: 'canteen',
      name: '远处社区食堂',
      category: '食堂',
      latitude: 31.9,
      longitude: 122.1
    }
  ];
  const bounds = {
    southwest: { latitude: 31.18, longitude: 121.42 },
    northeast: { latitude: 31.21, longitude: 121.45 }
  };

  assert.equal(getDefaultSelectedPlace(places, {
    categories: ['食堂'],
    bounds,
    scale: 12,
    origin: places[0]
  }).id, 'canteen');
});

test('getPlaceVisualMeta exposes the shared brand color and category marker style', () => {
  for (const category of CATEGORY_OPTIONS) {
    const meta = getPlaceVisualMeta(category);

    assert.ok(meta.color, `${category} should have a color`);
    assert.ok(meta.mapMarkerColor, `${category} should expose a map dot drawing color`);
    assert.equal(meta.mapMarkerColor, meta.color);
  }

  assert.equal(getPlaceVisualMeta('图书馆').mapMarkerColor, '#000000');
  assert.equal(getPlaceVisualMeta('图书馆').markerStyle, 'solid');
  assert.equal(getPlaceVisualMeta('食堂').mapMarkerColor, '#000000');
  assert.equal(getPlaceVisualMeta('食堂').markerStyle, 'inverse');
});

test('getPlaceDisplayPhotos returns configured photos without adding a placeholder', () => {
  assert.deepEqual(getPlaceDisplayPhotos({
    photos: ['cloud://places/a.jpg', '', 'cloud://places/b.jpg']
  }), ['cloud://places/a.jpg', 'cloud://places/b.jpg']);

  assert.deepEqual(getPlaceDisplayPhotos({ photos: [] }), []);
  assert.deepEqual(getPlaceDisplayPhotos({ imageUrls: 'cloud://places/one.jpg;cloud://places/two.jpg' }), [
    'cloud://places/one.jpg',
    'cloud://places/two.jpg'
  ]);
});

test('map cards and detail pages share address and hours display rules', () => {
  assert.equal(getPlaceDisplayAddress({ address: ' 上海市徐汇区淮海中路1555号 ' }), '上海市徐汇区淮海中路1555号');
  assert.equal(getPlaceDisplayAddress({ address: '' }), '地址待补充');
  assert.equal(getPlaceDisplayHours({ hours: ' 09:00-20:00 ' }), '09:00-20:00');
  assert.equal(getPlaceDisplayHours({ hours: '' }), '—');
  assert.equal(getPlaceDisplayHours({ hours: '以现场公示为准' }), '—');
  assert.equal(getPlaceNavigationLabel({ category: '图书馆' }), '去学习');
  assert.equal(getPlaceNavigationLabel({ category: '食堂' }), '去吃饭');
});

test('getDistanceText hides unavailable distances and formats nearby values', () => {
  assert.equal(getDistanceText(null), '');
  assert.equal(getDistanceText(Number.NaN), '');
  assert.equal(getDistanceText(0.32), '320 米');
  assert.equal(getDistanceText(1.26), '1.3 公里');
});

test('getDisplayPlaces filters by categories, visible bounds, and low-scale priority', () => {
  const places = [
    {
      id: 'major-library',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504,
      priority: 'major'
    },
    {
      id: 'small-canteen',
      name: '社区长者食堂',
      category: '食堂',
      latitude: 31.204,
      longitude: 121.551
    },
    {
      id: 'outside-service',
      name: '远处党群服务中心',
      category: '党群服务中心',
      latitude: 31.9,
      longitude: 122.1,
      priority: 'major'
    }
  ];
  const bounds = {
    southwest: { latitude: 31.1, longitude: 121.4 },
    northeast: { latitude: 31.3, longitude: 121.7 }
  };

  assert.deepEqual(getDisplayPlaces(places, {
    categories: ['图书馆', '食堂'],
    bounds,
    scale: 10
  }).map((place) => place.id), ['major-library']);

  assert.deepEqual(getDisplayPlaces(places, {
    categories: ['图书馆', '食堂'],
    bounds,
    scale: 12
  }).map((place) => place.id), ['major-library', 'small-canteen']);
});

test('getNearbyPlaces returns other places within the requested radius', () => {
  const target = {
    id: 'target',
    name: '上海图书馆',
    category: '图书馆',
    latitude: 31.2073,
    longitude: 121.4445
  };
  const nearby = {
    id: 'nearby',
    name: '衡山社区食堂',
    category: '食堂',
    latitude: 31.2042,
    longitude: 121.4462
  };
  const far = {
    id: 'far',
    name: '五角场街道社区党群服务中心',
    category: '党群服务中心',
    latitude: 31.3037,
    longitude: 121.5146
  };

  assert.deepEqual(getNearbyPlaces(target, [target, nearby, far], {
    radiusKm: 2,
    categories: ['图书馆', '食堂']
  }).map((place) => place.id), ['nearby']);
});
