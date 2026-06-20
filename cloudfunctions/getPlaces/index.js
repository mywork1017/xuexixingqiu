const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event = {}) => {
  const { category } = event;
  const where = category && category !== '全部' ? { category } : {};
  const result = await db.collection('places')
    .where(where)
    .orderBy('updatedAt', 'desc')
    .limit(1000)
    .get();

  return {
    data: result.data || []
  };
};
