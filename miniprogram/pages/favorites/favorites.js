const {
  getPlaceVisualMeta,
  normalizePlace,
  sortPlacesByFavoriteRecords
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const {
  clearLocalLoginState,
  getLocalFavoriteRecords,
  loadFavoriteRecords
} = require('../../utils/favorite-store');

function getStoredProfile() {
  const storedProfile = wx.getStorageSync('userProfile');
  return storedProfile || {
    nickName: '微信用户',
    avatarUrl: ''
  };
}

function getIsLoggedIn() {
  return Boolean(wx.getStorageSync('userProfile'));
}

function decoratePlace(place) {
  const meta = getPlaceVisualMeta(place.category);
  const targetHoursMap = {
    上海图书馆东馆: '9:00-20:30　全年无休',
    徐家汇书院: '10:00-22:00　全年无休',
    思南书局: '10:00-21:00　全年无休'
  };
  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    favoriteAvatarPath: meta.favoriteAvatarPath,
    displayHours: targetHoursMap[place.name] || place.hours || '以现场公示为准'
  };
}

Page({
  data: {
    navMetrics: getApp().getNavMetrics(),
    profile: getStoredProfile(),
    isLoggedIn: getIsLoggedIn(),
    favoritePlaces: [],
    favoriteCount: 0,
    emptyText: '要登录账号才能收藏'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }

    this.refreshFavorites();
  },

  refreshFavorites() {
    this.applyFavoriteRecords(getLocalFavoriteRecords());
    loadFavoriteRecords().then((favoriteRecords) => {
      this.applyFavoriteRecords(favoriteRecords);
    });
  },

  applyFavoriteRecords(favoriteRecords) {
    const isLoggedIn = getIsLoggedIn();
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) && cachedPlaces.length ? cachedPlaces : SAMPLE_PLACES;
    const normalizedPlaces = places.map(normalizePlace);
    const favoriteIdSet = new Set(favoriteRecords.map((record) => record.placeId));
    const favoritePlaces = isLoggedIn
      ? sortPlacesByFavoriteRecords(normalizedPlaces
        .filter((place) => favoriteIdSet.has(place.id)), favoriteRecords)
        .map(decoratePlace)
      : [];

    this.setData({
      profile: getStoredProfile(),
      isLoggedIn,
      favoritePlaces,
      favoriteCount: favoritePlaces.length,
      emptyText: isLoggedIn ? '在地图页收藏地点后，就可以在这里看到' : '要登录账号才能收藏'
    });
  },

  logout() {
    wx.showActionSheet({
      itemList: ['退出登录'],
      itemColor: '#b74b42',
      success: () => {
        clearLocalLoginState();
        this.setData({
          profile: getStoredProfile(),
          isLoggedIn: false,
          favoritePlaces: [],
          favoriteCount: 0,
          emptyText: '要登录账号才能收藏'
        });
      }
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
