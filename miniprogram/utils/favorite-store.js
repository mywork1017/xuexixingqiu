const FAVORITES_KEY = 'favoritePlaceIds';

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

function loadFavoriteIds() {
  if (!wx.cloud) {
    return Promise.resolve(getLocalFavoriteIds());
  }

  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'userFavorites',
      data: { action: 'list' },
      success: (res) => {
        const ids = res.result && Array.isArray(res.result.placeIds) ? res.result.placeIds : [];
        resolve(setLocalFavoriteIds(ids));
      },
      fail: () => {
        resolve(getLocalFavoriteIds());
      }
    });
  });
}

function toggleFavoriteId(placeId) {
  const favoriteIds = getLocalFavoriteIds();
  const existingIndex = favoriteIds.indexOf(placeId);
  const shouldFavorite = existingIndex < 0;

  if (shouldFavorite) {
    favoriteIds.push(placeId);
  } else {
    favoriteIds.splice(existingIndex, 1);
  }

  setLocalFavoriteIds(favoriteIds);

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
        const ids = res.result && Array.isArray(res.result.placeIds) ? res.result.placeIds : favoriteIds;
        const syncedIds = setLocalFavoriteIds(ids);
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
}

module.exports = {
  FAVORITES_KEY,
  clearLocalLoginState,
  getLocalFavoriteIds,
  loadFavoriteIds,
  setLocalFavoriteIds,
  toggleFavoriteId
};
