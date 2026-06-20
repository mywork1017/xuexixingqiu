const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const favorites = db.collection('userFavorites');

async function listFavorites(openid) {
  const result = await favorites
    .where({ _openid: openid })
    .get();

  return result.data.map((item) => item.placeId).filter(Boolean);
}

async function addFavorite(openid, placeId) {
  const existed = await favorites
    .where({ _openid: openid, placeId })
    .limit(1)
    .get();

  if (!existed.data.length) {
    const now = new Date();
    await favorites.add({
      data: {
        _openid: openid,
        placeId,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

async function removeFavorite(openid, placeId) {
  const existed = await favorites
    .where({ _openid: openid, placeId })
    .get();

  await Promise.all(existed.data.map((item) => favorites.doc(item._id).remove()));
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';
  const placeId = event.placeId;

  if (!OPENID) {
    return {
      ok: false,
      placeIds: []
    };
  }

  if (action === 'add' && placeId) {
    await addFavorite(OPENID, placeId);
  }

  if (action === 'remove' && placeId) {
    await removeFavorite(OPENID, placeId);
  }

  return {
    ok: true,
    placeIds: await listFavorites(OPENID)
  };
};
