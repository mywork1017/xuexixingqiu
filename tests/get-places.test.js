const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createGetPlaces(places) {
  const reads = [];
  const exports = {};
  const command = {
    gte: (minimum) => ({
      and: (maximum) => (value) => value >= minimum && value <= maximum
    }),
    lte: (maximum) => maximum
  };
  const db = {
    command,
    collection: () => {
      let where = {};
      let order;
      let offset = 0;
      let limit;
      const query = {
        where(value) { where = value; return query; },
        orderBy(value) { order = value; return query; },
        skip(value) { offset = value; return query; },
        limit(value) { limit = value; return query; },
        async get() {
          reads.push({ where, offset, limit });
          const data = places.filter((place) => Object.entries(where).every(([key, value]) => (
            typeof value === 'function' ? value(place[key]) : place[key] === value
          ))).sort((a, b) => String(a[order]).localeCompare(String(b[order])));
          return { data: data.slice(offset, offset + limit) };
        }
      };
      return query;
    }
  };
  const file = path.resolve(__dirname, '../cloudfunctions/getPlaces/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports,
    require: () => ({ init() {}, database: () => db })
  }, { filename: file });
  return { main: exports.main, reads };
}

const bounds = {
  southwest: { latitude: 31, longitude: 121 },
  northeast: { latitude: 32, longitude: 122 }
};

test('范围请求在数据库同时筛选经纬度和类别，包含边界点', async () => {
  const { main, reads } = createGetPlaces([
    { _id: 'inside', category: '图书馆', latitude: 31.5, longitude: 121.5 },
    { _id: 'edge', category: '图书馆', latitude: 31, longitude: 122 },
    { _id: 'longitude-outside', category: '图书馆', latitude: 31.5, longitude: 123 },
    { _id: 'latitude-outside', category: '图书馆', latitude: 30, longitude: 121.5 },
    { _id: 'other-category', category: '食堂', latitude: 31.5, longitude: 121.5 }
  ]);
  const result = await main({ mode: 'bounds', bounds, limit: 500, category: '图书馆' });
  assert.deepEqual(Array.from(result.data, (place) => place._id), ['edge', 'inside']);
  assert.equal(result.hasMore, false);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].limit, 501);
  assert.equal(typeof reads[0].where.latitude, 'function');
  assert.equal(typeof reads[0].where.longitude, 'function');
});

test('范围结果超过500条才报告截断，正好500条仍是完整结果', async () => {
  const places = Array.from({ length: 501 }, (_, index) => ({
    _id: String(index).padStart(4, '0'), latitude: 31.5, longitude: 121.5
  }));
  const truncated = await createGetPlaces(places).main({ mode: 'bounds', bounds, limit: 500 });
  assert.equal(truncated.data.length, 500);
  assert.equal(truncated.hasMore, true);
  const complete = await createGetPlaces(places.slice(0, 500)).main({ mode: 'bounds', bounds, limit: 500 });
  assert.equal(complete.data.length, 500);
  assert.equal(complete.hasMore, false);
});

test('范围无效时不读取数据库，全量分页继续按ID稳定取数', async () => {
  const { main, reads } = createGetPlaces([{ _id: 'c' }, { _id: 'a' }, { _id: 'b' }]);
  const invalid = await main({ mode: 'bounds', bounds: {} });
  assert.equal(invalid.data.length, 0);
  assert.equal(reads.length, 0);
  const first = await main({ mode: 'page', offset: 0, limit: 2 });
  assert.deepEqual(Array.from(first.data, (place) => place._id), ['a', 'b']);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 2);
  const last = await main({ mode: 'page', offset: first.nextOffset, limit: 2 });
  assert.deepEqual(Array.from(last.data, (place) => place._id), ['c']);
  assert.equal(last.hasMore, false);
});
