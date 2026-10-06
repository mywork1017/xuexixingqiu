const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const command = db.command;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

function normalizeLimit(value) {
  const limit = Math.floor(Number(value || DEFAULT_PAGE_SIZE));
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(limit) ? limit : DEFAULT_PAGE_SIZE));
}

function normalizeOffset(value) {
  const offset = Math.floor(Number(value || 0));
  return Math.max(0, Number.isFinite(offset) ? offset : 0);
}

function normalizeBounds(bounds) {
  const southwest = bounds && bounds.southwest;
  const northeast = bounds && bounds.northeast;
  const values = [
    southwest && southwest.latitude,
    southwest && southwest.longitude,
    northeast && northeast.latitude,
    northeast && northeast.longitude
  ].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    southwest: { latitude: Math.min(values[0], values[2]), longitude: Math.min(values[1], values[3]) },
    northeast: { latitude: Math.max(values[0], values[2]), longitude: Math.max(values[1], values[3]) }
  };
}

exports.main = async (event = {}) => {
  const { category, mode } = event;
  const limit = normalizeLimit(event.limit);
  const where = category && category !== '全部' ? { category } : {};

  if (mode === 'bounds') {
    const bounds = normalizeBounds(event.bounds);
    if (!bounds) return { data: [], hasMore: false };
    const result = await db.collection('places')
      .where({
        ...where,
        latitude: command.gte(bounds.southwest.latitude).and(command.lte(bounds.northeast.latitude)),
        longitude: command.gte(bounds.southwest.longitude).and(command.lte(bounds.northeast.longitude))
      })
      .orderBy('_id', 'asc')
      .limit(limit + 1)
      .get();
    const data = result.data || [];
    return { data: data.slice(0, limit), hasMore: data.length > limit };
  }

  const offset = normalizeOffset(event.offset);
  const result = await db.collection('places')
    .where(where)
    .orderBy('_id', 'asc')
    .skip(offset)
    .limit(limit)
    .get();
  const data = result.data || [];

  return {
    data,
    hasMore: data.length === limit,
    nextOffset: offset + data.length
  };
};
