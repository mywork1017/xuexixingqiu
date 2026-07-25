const FAVORITES_KEY = 'favoritePlaceIds';
const FAVORITE_RECORDS_KEY = 'favoriteRecords';

function uniqueIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)));
}

function getLocalFavoriteIds() {
  return uniqueIds(wx.getStorageSync(FAVORITES_KEY));
}

function setLocalFavoriteIds(ids) {
  const favoriteIds = uniqueIds(ids);
  wx.setStorageSync(FAVORITES_KEY, favoriteIds);
  return favoriteIds;
}

function normalizeFavoriteRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && record.placeId)
    .map((record) => ({
      placeId: record.placeId,
      createdAt: record.createdAt || '',
      updatedAt: record.updatedAt || record.createdAt || ''
    }));
}

function getLocalFavoriteRecords() {
  const records = normalizeFavoriteRecords(wx.getStorageSync(FAVORITE_RECORDS_KEY));
  if (records.length) {
    return records;
  }

  return getLocalFavoriteIds().map((placeId, index) => ({
    placeId,
    createdAt: '',
    updatedAt: '',
    localOrder: index
  }));
}

function setLocalFavoriteRecords(records) {
  const favoriteRecords = normalizeFavoriteRecords(records);
  wx.setStorageSync(FAVORITE_RECORDS_KEY, favoriteRecords);
  setLocalFavoriteIds(favoriteRecords.map((record) => record.placeId));
  return favoriteRecords;
}

function loadFavoriteIds() {
  if (!wx.cloud) {
    return Promise.resolve(getLocalFavoriteIds());
  }

  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'userFavorites',
      data: { action: 'list' },
      success: (res) => {
        if (res.result && Array.isArray(res.result.records)) {
          resolve(setLocalFavoriteRecords(res.result.records).map((record) => record.placeId));
          return;
        }

        const ids = res.result && Array.isArray(res.result.placeIds) ? res.result.placeIds : [];
        setLocalFavoriteIds(ids);
        resolve(ids);
      },
      fail: () => {
        resolve(getLocalFavoriteIds());
      }
    });
  });
}

function loadFavoriteRecords() {
  if (!wx.cloud) {
    return Promise.resolve(getLocalFavoriteRecords());
  }

  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'userFavorites',
      data: { action: 'list' },
      success: (res) => {
        if (res.result && Array.isArray(res.result.records)) {
          resolve(setLocalFavoriteRecords(res.result.records));
          return;
        }

        const ids = res.result && Array.isArray(res.result.placeIds) ? res.result.placeIds : [];
        setLocalFavoriteIds(ids);
        resolve(getLocalFavoriteRecords());
      },
      fail: () => {
        resolve(getLocalFavoriteRecords());
      }
    });
  });
}

function toggleFavoriteId(placeId) {
  const favoriteIds = getLocalFavoriteIds();
  const favoriteRecords = getLocalFavoriteRecords();
  const existingIndex = favoriteIds.indexOf(placeId);
  const shouldFavorite = existingIndex < 0;

  if (shouldFavorite) {
    favoriteIds.push(placeId);
    favoriteRecords.unshift({
      placeId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } else {
    favoriteIds.splice(existingIndex, 1);
    const recordIndex = favoriteRecords.findIndex((record) => record.placeId === placeId);
    if (recordIndex >= 0) {
      favoriteRecords.splice(recordIndex, 1);
    }
  }

  setLocalFavoriteIds(favoriteIds);
  setLocalFavoriteRecords(favoriteRecords);

  if (!wx.cloud) {
    return Promise.resolve({
      favoriteIds,
      isFavorite: shouldFavorite
    });
  }

  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'userFavorites',
      data: {
        action: shouldFavorite ? 'add' : 'remove',
        placeId
      },
      success: (res) => {
        const syncedRecords = res.result && Array.isArray(res.result.records)
          ? setLocalFavoriteRecords(res.result.records)
          : setLocalFavoriteRecords(favoriteRecords);
        const syncedIds = res.result && Array.isArray(res.result.placeIds)
          ? setLocalFavoriteIds(res.result.placeIds)
          : syncedRecords.map((record) => record.placeId);
        resolve({
          favoriteIds: syncedIds,
          isFavorite: syncedIds.indexOf(placeId) >= 0
        });
      },
      fail: () => {
        resolve({
          favoriteIds,
          isFavorite: shouldFavorite
        });
      }
    });
  });
}

function clearLocalLoginState() {
  wx.removeStorageSync('userProfile');
  wx.removeStorageSync(FAVORITE_RECORDS_KEY);
  wx.removeStorageSync(FAVORITES_KEY);
}

module.exports = {
  FAVORITES_KEY,
  FAVORITE_RECORDS_KEY,
  clearLocalLoginState,
  getLocalFavoriteIds,
  getLocalFavoriteRecords,
  loadFavoriteIds,
  loadFavoriteRecords,
  setLocalFavoriteIds,
  setLocalFavoriteRecords,
  toggleFavoriteId
};
