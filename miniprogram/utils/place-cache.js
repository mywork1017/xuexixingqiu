const PLACES_CACHE_KEY = 'places:nature-v4';
const MANIFEST_KEY = `${PLACES_CACHE_KEY}:manifest`;
const MAX_CHUNK_BYTES = 512 * 1024;
let generation = 0;

function removeKeys(storage, keys) {
  if (typeof storage.removeStorageSync !== 'function') return;
  keys.forEach((key) => {
    try { storage.removeStorageSync(key); } catch (error) { /* Cache cleanup is optional. */ }
  });
}

function readPlacesCache(storage) {
  try {
    const manifest = storage.getStorageSync(MANIFEST_KEY);
    if (manifest && manifest.version === 1 && Array.isArray(manifest.keys)) {
      const chunks = manifest.keys.map((key) => storage.getStorageSync(key));
      if (chunks.every(Array.isArray)) {
        const places = [].concat(...chunks);
        if (places.length === manifest.count) return places;
      }
    }
    const legacy = storage.getStorageSync(PLACES_CACHE_KEY);
    return Array.isArray(legacy) ? legacy : [];
  } catch (error) {
    return [];
  }
}

function writePlacesCache(storage, places) {
  const writtenKeys = [];
  try {
    // Three bytes per UTF-16 code unit safely bounds UTF-8 size, including CJK.
    const chunks = [];
    let chunk = [];
    let size = 2;
    places.forEach((place) => {
      const recordSize = JSON.stringify(place).length * 3 + 1;
      if (recordSize + 2 > MAX_CHUNK_BYTES) throw new Error('Place exceeds cache chunk limit');
      if (size + recordSize > MAX_CHUNK_BYTES) {
        chunks.push(chunk);
        chunk = [];
        size = 2;
      }
      chunk.push(place);
      size += recordSize;
    });
    chunks.push(chunk);
    const previous = storage.getStorageSync(MANIFEST_KEY);
    const prefix = `${PLACES_CACHE_KEY}:${Date.now()}:${++generation}`;
    const keys = chunks.map((unused, index) => chunks.length === 1 ? PLACES_CACHE_KEY : `${prefix}:${index}`);
    chunks.forEach((records, index) => {
      storage.setStorageSync(keys[index], records);
      writtenKeys.push(keys[index]);
    });
    // Publish after every chunk succeeds, so partial writes keep the prior cache.
    storage.setStorageSync(MANIFEST_KEY, { version: 1, keys, count: places.length });
    const previousKeys = previous && Array.isArray(previous.keys) ? previous.keys : [PLACES_CACHE_KEY];
    removeKeys(storage, previousKeys.filter((key) => !keys.includes(key)));
    return true;
  } catch (error) {
    removeKeys(storage, writtenKeys.filter((key) => key !== PLACES_CACHE_KEY));
    return false;
  }
}

module.exports = { readPlacesCache, writePlacesCache };
