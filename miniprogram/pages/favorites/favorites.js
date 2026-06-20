const { normalizePlace } = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');

const FAVORITES_KEY = 'favoritePlaceIds';

function getStoredFavoriteIds() {
  const ids = wx.getStorageSync(FAVORITES_KEY);
  return Array.isArray(ids) ? ids : [];
}

Page({
  data: {
    favoritePlaces: []
  },

  onShow() {
    this.refreshFavorites();
  },

  refreshFavorites() {
    const favoritePlaceIds = getStoredFavoriteIds();
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) && cachedPlaces.length ? cachedPlaces : SAMPLE_PLACES;
    const normalizedPlaces = places.map(normalizePlace);
    const favoriteIdSet = new Set(favoritePlaceIds);

    this.setData({
      favoritePlaces: normalizedPlaces.filter((place) => favoriteIdSet.has(place.id))
    });
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
