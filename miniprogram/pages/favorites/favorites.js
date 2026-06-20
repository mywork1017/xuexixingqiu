const { CATEGORY_META, normalizePlace } = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const { clearLocalLoginState, getLocalFavoriteIds, loadFavoriteIds } = require('../../utils/favorite-store');

function getStoredProfile() {
  return wx.getStorageSync('userProfile') || {
    nickName: '微信用户',
    avatarUrl: ''
  };
}

function decoratePlace(place) {
  const meta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
  const targetHoursMap = {
    上海图书馆东馆: '9:00-20:30　全年无休',
    徐家汇书院: '10:00-22:00　全年无休',
    思南书局: '10:00-21:00　全年无休'
  };
  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    displayHours: targetHoursMap[place.name] || place.hours || '以现场公示为准'
  };
}

Page({
  data: {
    navMetrics: getApp().getNavMetrics(),
    profile: getStoredProfile(),
    favoritePlaces: [],
    favoriteCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }

    this.refreshFavorites();
  },

  refreshFavorites() {
    this.applyFavoriteIds(getLocalFavoriteIds());
    loadFavoriteIds().then((favoriteIds) => {
      this.applyFavoriteIds(favoriteIds);
    });
  },

  applyFavoriteIds(favoritePlaceIds) {
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) && cachedPlaces.length ? cachedPlaces : SAMPLE_PLACES;
    const normalizedPlaces = places.map(normalizePlace);
    const favoriteIdSet = new Set(favoritePlaceIds);
    const favoritePlaces = normalizedPlaces
      .filter((place) => favoriteIdSet.has(place.id))
      .map(decoratePlace);

    this.setData({
      profile: getStoredProfile(),
      favoritePlaces,
      favoriteCount: favoritePlaces.length
    });
  },

  logout() {
    clearLocalLoginState();
    this.setData({
      profile: getStoredProfile()
    });
  },

  openSettings() {
    wx.openSetting({});
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
