const test = require('node:test');
const assert = require('node:assert/strict');
const { readPlacesCache, writePlacesCache } = require('../miniprogram/utils/place-cache');

const LEGACY_KEY = 'places:nature-v4';
const MANIFEST_KEY = `${LEGACY_KEY}:manifest`;

function createStorage() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    getStorageSync: (key) => values.get(key),
    setStorageSync(key, value) {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      assert.ok(bytes < 1024 * 1024, '模拟手机单个缓存键 1MB 限制');
      writes.push({ key, bytes });
      values.set(key, value);
    },
    removeStorageSync: (key) => values.delete(key)
  };
}

const largePlaces = Array.from({ length: 1677 }, (_, index) => ({
  id: `place-${index}`,
  name: '中文地点🌳',
  description: '地点说明'.repeat(200),
  photos: [`https://example.com/${'photo'.repeat(200)}.jpg`]
}));

test('超过1MB的完整地点分块缓存，中文和emoji均计入大小并能完整恢复', () => {
  const storage = createStorage();
  assert.ok(Buffer.byteLength(JSON.stringify(largePlaces)) > 1024 * 1024);
  assert.equal(writePlacesCache(storage, largePlaces), true);
  assert.deepEqual(readPlacesCache(storage), largePlaces);
  assert.ok(storage.values.get(MANIFEST_KEY).keys.length > 1);
  assert.ok(storage.writes.every((write) => write.bytes <= 512 * 1024));
});

test('兼容旧单键缓存，更新到分块后清理旧数据，缩小后清理旧块', () => {
  const storage = createStorage();
  storage.values.set(LEGACY_KEY, [{ id: 'legacy' }]);
  assert.deepEqual(readPlacesCache(storage), [{ id: 'legacy' }]);
  writePlacesCache(storage, largePlaces);
  const oldKeys = storage.values.get(MANIFEST_KEY).keys;
  assert.equal(storage.values.has(LEGACY_KEY), false);
  writePlacesCache(storage, [{ id: 'small' }]);
  assert.ok(oldKeys.every((key) => !storage.values.has(key)));
  assert.deepEqual(readPlacesCache(storage), [{ id: 'small' }]);
});

test('分块中途写入失败保留原完整缓存，并清理未发布的新块', () => {
  const storage = createStorage();
  writePlacesCache(storage, largePlaces);
  const oldKeys = [...storage.values.keys()];
  const write = storage.setStorageSync;
  let count = 0;
  storage.setStorageSync = (key, value) => {
    if (++count === 2) throw new Error('storage full');
    write(key, value);
  };
  assert.equal(writePlacesCache(storage, largePlaces.map((place) => ({ ...place, name: '更新名称' }))), false);
  assert.deepEqual([...storage.values.keys()], oldKeys);
  assert.deepEqual(readPlacesCache(storage), largePlaces);
});

test('缺失分块与缓存读取异常不会返回残缺数据或阻塞页面', () => {
  const storage = createStorage();
  writePlacesCache(storage, largePlaces);
  storage.values.delete(storage.values.get(MANIFEST_KEY).keys[0]);
  assert.deepEqual(readPlacesCache(storage), []);
  assert.deepEqual(readPlacesCache({ getStorageSync() { throw new Error('unavailable'); } }), []);
});
