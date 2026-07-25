const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  createPlaceImportId,
  filterPlaces,
  filterPlacesByCategories,
  getActiveCategoriesForFilter,
  getDisplayPlaces,
  getDefaultSelectedPlace,
  getPlaceDisplayPhotos,
  getPlaceVisualMeta,
  getNearbyPlaces,
  getDistanceText,
  sortPlacesByFavoriteRecords,
  placesToImportDocuments,
  placesToMarkers,
  parsePlacesCsv,
  normalizePlace
} = require('../miniprogram/utils/place-utils');

test('CATEGORY_OPTIONS contains the five supported place categories', () => {
  assert.deepEqual(CATEGORY_OPTIONS, [
    '图书馆',
    '书店',
    '自习室',
    '党群服务中心',
    '社区食堂'
  ]);
});

test('CATEGORY_FILTER_OPTIONS starts with 全部 before place categories', () => {
  assert.deepEqual(CATEGORY_FILTER_OPTIONS, [
    '全部',
    '图书馆',
    '书店',
    '自习室',
    '党群服务中心',
    '社区食堂'
  ]);
});

test('getActiveCategoriesForFilter maps 全部 and single category choices', () => {
  assert.deepEqual(getActiveCategoriesForFilter('全部'), CATEGORY_OPTIONS);
  assert.deepEqual(getActiveCategoriesForFilter('书店'), ['书店']);
  assert.deepEqual(getActiveCategoriesForFilter('不存在'), CATEGORY_OPTIONS);
});

test('filterPlaces returns all places for 全部 and only matching places for a category', () => {
  const places = [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '浦东新区党群服务中心', category: '党群服务中心' },
    { name: '静安社区食堂', category: '社区食堂' }
  ];

  assert.equal(filterPlaces(places, '全部').length, 3);
  assert.deepEqual(filterPlaces(places, '图书馆'), [
    { name: '徐家汇书院', category: '图书馆' }
  ]);
});

test('filterPlacesByCategories supports compact multi-select filtering', () => {
  const places = [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '浦东新区党群服务中心', category: '党群服务中心' },
    { name: '静安社区食堂', category: '社区食堂' }
  ];

  assert.deepEqual(filterPlacesByCategories(places, ['图书馆', '社区食堂']), [
    { name: '徐家汇书院', category: '图书馆' },
    { name: '静安社区食堂', category: '社区食堂' }
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
    tags: '图书馆;自习',
    updatedAt: '2026-06-19'
  });

  assert.equal(place.latitude, 31.2039);
  assert.equal(place.longitude, 121.5504);
  assert.deepEqual(place.tags, ['图书馆', '自习']);
  assert.equal(place.id, 'p1');
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
  assert.equal(markers[0].width, 18);
  assert.equal(markers[0].height, 18);
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
      name: '徐家汇书院',
      category: '图书馆',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ], {
    selectedPlaceId: 'p2',
    mapDotIconPaths: { 图书馆: 'tmp/library-dot.png' },
    selectedLabelIcon: {
      placeId: 'p2',
      path: 'tmp/selected-label.png',
      width: 128,
      height: 42
    }
  });

  const normalDot = markers.find((marker) => marker.placeId === 'p1' && marker.markerType === 'dot');
  const selectedDot = markers.find((marker) => marker.placeId === 'p2' && marker.markerType === 'dot');
  const selectedPin = markers.find((marker) => marker.placeId === 'p2' && marker.markerType === 'selected');
  const selectedLabel = markers.find((marker) => marker.placeId === 'p2' && marker.markerType === 'selected-label');

  assert.equal(markers[0].width, 18);
  assert.equal(markers.length, 4);
  assert.equal(normalDot.iconPath, 'tmp/library-dot.png');
  assert.equal(selectedDot.iconPath, 'tmp/library-dot.png');
  assert.equal(selectedDot.width, 20);
  assert.equal(selectedDot.height, 20);
  assert.equal(selectedDot.label, undefined);
  assert.ok(selectedDot.zIndex > normalDot.zIndex);
  assert.equal(selectedPin.iconPath, '/assets/markers/map/ditu_xiangqing_ditu_tsg_xuanzhong.png');
  assert.equal(selectedPin.width, 27);
  assert.equal(selectedPin.height, 34);
  assert.deepEqual(selectedPin.anchor, { x: 0.5, y: 1 });
  assert.ok(selectedPin.zIndex > selectedDot.zIndex);
  assert.ok(selectedLabel.zIndex > selectedPin.zIndex);
  assert.equal(selectedLabel.iconPath, 'tmp/selected-label.png');
  assert.equal(selectedLabel.width, 128);
  assert.equal(selectedLabel.height, 42);
  assert.deepEqual(selectedLabel.anchor, { x: 0.5, y: 0 });
  assert.equal(selectedLabel.label, undefined);
});

test('placesToMarkers places selected marker pieces last so the tapped place is visually on top', () => {
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
      category: '社区食堂',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ], {
    selectedPlaceId: 'p1',
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      社区食堂: 'tmp/canteen-dot.png'
    },
    selectedLabelIcon: {
      placeId: 'p1',
      path: 'tmp/selected-label.png',
      width: 128,
      height: 42
    }
  });

  assert.deepEqual(markers.slice(-3).map((marker) => marker.markerType), [
    'dot',
    'selected',
    'selected-label'
  ]);
  assert.deepEqual(markers.slice(-3).map((marker) => marker.placeId), ['p1', 'p1', 'p1']);
  assert.ok(markers.at(-1).zIndex > markers.find((marker) => marker.placeId === 'p2').zIndex);
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
      id: 'bookstore',
      name: '衡山和集',
      category: '书店',
      latitude: 31.2042,
      longitude: 121.4462
    },
    {
      id: 'canteen',
      name: '斜土路街道社区食堂',
      category: '社区食堂',
      latitude: 31.1931,
      longitude: 121.4342
    }
  ];
  const firstSelection = placesToMarkers(places, {
    selectedPlaceId: 'library',
    allPlaceIds: places.map((place) => place.id),
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      书店: 'tmp/bookstore-dot.png',
      社区食堂: 'tmp/canteen-dot.png'
    }
  });
  const secondSelection = placesToMarkers(places, {
    selectedPlaceId: 'canteen',
    allPlaceIds: places.map((place) => place.id),
    mapDotIconPaths: {
      图书馆: 'tmp/library-dot.png',
      书店: 'tmp/bookstore-dot.png',
      社区食堂: 'tmp/canteen-dot.png'
    }
  });

  assert.ok(
    firstSelection.find((marker) => marker.placeId === 'library' && marker.markerType === 'selected').zIndex
      > firstSelection.find((marker) => marker.placeId === 'canteen' && marker.markerType === 'dot').zIndex
  );
  assert.deepEqual(
    secondSelection
      .filter((marker) => marker.markerType === 'dot')
      .map((marker) => marker.placeId),
    ['library', 'bookstore', 'canteen']
  );
  assert.ok(
    secondSelection.find((marker) => marker.placeId === 'library' && marker.markerType === 'dot').zIndex
      < secondSelection.find((marker) => marker.placeId === 'canteen' && marker.markerType === 'dot').zIndex
  );
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
      category: '社区食堂',
      latitude: 31.1931,
      longitude: 121.4342
    },
    {
      id: 'far-canteen',
      name: '远处社区食堂',
      category: '社区食堂',
      latitude: 31.9,
      longitude: 122.1
    }
  ];
  const bounds = {
    southwest: { latitude: 31.18, longitude: 121.42 },
    northeast: { latitude: 31.21, longitude: 121.45 }
  };

  assert.equal(getDefaultSelectedPlace(places, {
    categories: ['社区食堂'],
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
      category: '社区食堂',
      latitude: 31.9,
      longitude: 122.1
    }
  ];
  const bounds = {
    southwest: { latitude: 31.18, longitude: 121.42 },
    northeast: { latitude: 31.21, longitude: 121.45 }
  };

  assert.equal(getDefaultSelectedPlace(places, {
    categories: ['社区食堂'],
    bounds,
    scale: 12,
    origin: places[0]
  }).id, 'canteen');
});

test('placesToMarkers reuses selected marker icons for the detail page map', () => {
  const markers = placesToMarkers([
    {
      id: 'p1',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504
    }
  ], {
    selectedPlaceId: 'p1',
    markerUsage: 'detail-map',
    selectedLabelIcon: {
      placeId: 'p1',
      path: 'tmp/detail-selected-label.png',
      width: 144,
      height: 42
    }
  });

  const selectedPin = markers.find((marker) => marker.markerType === 'selected');
  const selectedLabel = markers.find((marker) => marker.markerType === 'selected-label');
  assert.equal(selectedPin.iconPath, '/assets/markers/map/ditu_xiangqing_ditu_tsg_xuanzhong.png');
  assert.equal(selectedLabel.iconPath, 'tmp/detail-selected-label.png');
  assert.deepEqual(selectedLabel.anchor, { x: 0.5, y: 0 });
});

test('getPlaceVisualMeta exposes the agreed icon reuse groups for every category', () => {
  for (const category of CATEGORY_OPTIONS) {
    const meta = getPlaceVisualMeta(category);

    assert.ok(meta.color, `${category} should have a color`);
    assert.ok(meta.mapMarkerColor, `${category} should expose a map dot drawing color`);
    assert.ok(meta.mapSelectedMarkerIconPath.includes('/markers/map/'), `${category} should use a selected marker`);
    assert.ok(meta.mapCardAvatarPath.includes('/place-avatars/category/'), `${category} should use the shared category icon`);

    assert.notEqual(meta.mapMarkerColor, meta.mapSelectedMarkerIconPath);
    assert.equal(meta.mapSelectedMarkerIconPath, meta.detailMapSelectedMarkerIconPath);
    assert.equal(meta.mapCardAvatarPath, meta.detailMainAvatarPath);
    assert.equal(meta.mapCardAvatarPath, meta.nearbyAvatarPath);
    assert.equal(meta.mapCardAvatarPath, meta.favoriteAvatarPath);
  }
});

test('getPlaceDisplayPhotos returns place photos or the default cover image', () => {
  assert.deepEqual(getPlaceDisplayPhotos({
    photos: ['cloud://places/a.jpg', '', 'cloud://places/b.jpg']
  }), ['cloud://places/a.jpg', 'cloud://places/b.jpg']);

  assert.deepEqual(getPlaceDisplayPhotos({ photos: [] }), ['/assets/backdrops/detail-cover.png']);
  assert.deepEqual(getPlaceDisplayPhotos({ imageUrls: 'cloud://places/one.jpg;cloud://places/two.jpg' }), [
    'cloud://places/one.jpg',
    'cloud://places/two.jpg'
  ]);
});

test('getDistanceText hides unavailable distances and formats nearby values', () => {
  assert.equal(getDistanceText(null), '');
  assert.equal(getDistanceText(Number.NaN), '');
  assert.equal(getDistanceText(0.32), '320 米');
  assert.equal(getDistanceText(1.26), '1.3 公里');
});

test('sortPlacesByFavoriteRecords orders latest favorites first', () => {
  const places = [
    { id: 'old', name: '旧收藏' },
    { id: 'new', name: '新收藏' },
    { id: 'missing-date', name: '无时间收藏' }
  ];
  const records = [
    { placeId: 'old', createdAt: '2026-06-19T10:00:00.000Z' },
    { placeId: 'new', createdAt: '2026-06-20T10:00:00.000Z' },
    { placeId: 'missing-date' }
  ];

  assert.deepEqual(sortPlacesByFavoriteRecords(places, records).map((place) => place.id), [
    'new',
    'old',
    'missing-date'
  ]);
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
      id: 'small-study-room',
      name: '社区自习室',
      category: '自习室',
      latitude: 31.204,
      longitude: 121.551
    },
    {
      id: 'outside-bookstore',
      name: '远处书店',
      category: '书店',
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
    categories: ['图书馆', '自习室', '书店'],
    bounds,
    scale: 10
  }).map((place) => place.id), ['major-library']);

  assert.deepEqual(getDisplayPlaces(places, {
    categories: ['图书馆', '自习室', '书店'],
    bounds,
    scale: 12
  }).map((place) => place.id), ['major-library', 'small-study-room']);
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
    name: '衡山和集',
    category: '书店',
    latitude: 31.2042,
    longitude: 121.4462
  };
  const far = {
    id: 'far',
    name: '五角场自习室',
    category: '自习室',
    latitude: 31.3037,
    longitude: 121.5146
  };

  assert.deepEqual(getNearbyPlaces(target, [target, nearby, far], {
    radiusKm: 2,
    categories: ['书店', '自习室']
  }).map((place) => place.id), ['nearby']);
});

test('parsePlacesCsv parses the manual import template', () => {
  const rows = parsePlacesCsv([
    'name,category,latitude,longitude,address,hours,phone,tags,description,source,updatedAt',
    '上海图书馆东馆,图书馆,31.2039,121.5504,上海市浦东新区合欢路300号,9:00-20:30,021-38829588,图书馆;自习,大型公共图书馆,manual,2026-06-19'
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '上海图书馆东馆');
  assert.equal(rows[0].category, '图书馆');
  assert.equal(rows[0].latitude, 31.2039);
  assert.deepEqual(rows[0].tags, ['图书馆', '自习']);
});

test('places-template.csv is ready for a first real import batch', () => {
  const csvPath = path.join(__dirname, '..', 'data', 'places-template.csv');
  const rows = parsePlacesCsv(fs.readFileSync(csvPath, 'utf8'));
  const categories = new Set(rows.map((row) => row.category));

  assert.ok(rows.length >= 30);
  assert.deepEqual([...categories].sort(), [...CATEGORY_OPTIONS].sort());

  for (const row of rows) {
    assert.ok(row.name, 'name is required');
    assert.ok(row.address, `${row.name} address is required`);
    assert.ok(Number.isFinite(row.latitude), `${row.name} latitude must be a number`);
    assert.ok(Number.isFinite(row.longitude), `${row.name} longitude must be a number`);
    assert.ok(row.latitude >= 30.6 && row.latitude <= 31.9, `${row.name} latitude should be near Shanghai`);
    assert.ok(row.longitude >= 120.8 && row.longitude <= 122.2, `${row.name} longitude should be near Shanghai`);
  }
});

test('places import documents have stable unique _id values for overwrite imports', () => {
  const csvPath = path.join(__dirname, '..', 'data', 'places-template.csv');
  const rows = parsePlacesCsv(fs.readFileSync(csvPath, 'utf8'));
  const documents = placesToImportDocuments(rows);
  const ids = new Set(documents.map((document) => document._id));

  assert.equal(ids.size, rows.length);
  assert.equal(documents[0]._id, createPlaceImportId(rows[0]));
  assert.ok(documents.every((document) => document._id.startsWith('place_')));
});
