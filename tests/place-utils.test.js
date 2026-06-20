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
  getNearbyPlaces,
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

test('placesToMarkers maps places into stable WeChat map marker objects', () => {
  const markers = placesToMarkers([
    {
      id: 'p1',
      name: '上海图书馆东馆',
      category: '图书馆',
      latitude: 31.2039,
      longitude: 121.5504,
      address: '上海市浦东新区合欢路300号'
    }
  ]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, 1);
  assert.equal(markers[0].placeId, 'p1');
  assert.equal(markers[0].latitude, 31.2039);
  assert.equal(markers[0].iconPath, '/assets/markers/library-dot.png');
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
  ], { selectedPlaceId: 'p2' });

  assert.equal(markers[0].width, 18);
  assert.equal(markers[1].iconPath, '/assets/markers/library-selected.png');
  assert.equal(markers[1].width, 32);
  assert.equal(markers[1].height, 32);
  assert.equal(markers[1].zIndex, 10);
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
