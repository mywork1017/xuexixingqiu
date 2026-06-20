const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getNearbyPlaces,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const { getLocalFavoriteIds, loadFavoriteIds, toggleFavoriteId } = require('../../utils/favorite-store');

function createCategoryTabs(activeFilter) {
  const chipWidths = {
    全部: 92,
    图书馆: 132,
    书店: 116,
    自习室: 132,
    社区食堂: 164
  };

  return CATEGORY_FILTER_OPTIONS
    .filter((category) => category !== '党群服务中心')
    .map((category) => ({
      name: category,
      color: category === '全部' ? '#d2a66b' : CATEGORY_META[category].color,
      width: chipWidths[category] || 132,
      active: activeFilter === category
    }));
}

function withCategoryMeta(place) {
  const meta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
  const displayHours = place.name === '思南书局' ? '10:00-21:00　全年无休' : (place.hours || '以现场公示为准');
  const displayDescription = place.name === '思南书局'
    ? '坐落在思南公馆内的独立书店，藏书丰富，适合阅读与慢慢逛书。'
    : place.description;
  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    displayCover: (place.photos && place.photos[0]) || '/assets/backdrops/detail-cover.png',
    displayDescription,
    displayHours
  };
}

Page({
  data: {
    navMetrics: getApp().getNavMetrics(),
    place: null,
    allPlaces: [],
    mapMarkers: [],
    favoritePlaceIds: [],
    isFavorite: false,
    nearbyFilter: '全部',
    nearbyCategories: CATEGORY_OPTIONS,
    nearbyCategoryTabs: createCategoryTabs('全部'),
    nearbyPlaces: []
  },

  onLoad(options) {
    const placeId = decodeURIComponent(options.id || '');
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) && cachedPlaces.length ? cachedPlaces : SAMPLE_PLACES;
    const normalizedPlaces = places.map(normalizePlace);
    const place = normalizedPlaces.find((item) => item.id === placeId);

    if (!place) {
      wx.showToast({
        title: '地点不存在',
        icon: 'none'
      });
      return;
    }

    const favoritePlaceIds = getLocalFavoriteIds();
    this.setData({
      place: withCategoryMeta(place),
      allPlaces: normalizedPlaces,
      mapMarkers: placesToMarkers([place]),
      favoritePlaceIds,
      isFavorite: favoritePlaceIds.indexOf(place.id) >= 0
    }, () => {
      this.refreshNearbyPlaces();
    });
  },

  onShow() {
    const favoritePlaceIds = getLocalFavoriteIds();
    this.setData({
      favoritePlaceIds,
      isFavorite: this.data.place ? favoritePlaceIds.indexOf(this.data.place.id) >= 0 : false
    });

    loadFavoriteIds().then((syncedIds) => {
      this.setData({
        favoritePlaceIds: syncedIds,
        isFavorite: this.data.place ? syncedIds.indexOf(this.data.place.id) >= 0 : false
      });
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({
      url: '/pages/map/map'
    });
  },

  openLocation() {
    const { place } = this.data;
    if (!place) {
      return;
    }

    wx.openLocation({
      latitude: place.latitude,
      longitude: place.longitude,
      name: place.name,
      address: place.address,
      scale: 16
    });
  },

  toggleFavorite() {
    const { place } = this.data;
    if (!place) {
      return;
    }

    toggleFavoriteId(place.id).then(({ favoriteIds, isFavorite }) => {
      this.setData({
        favoritePlaceIds: favoriteIds,
        isFavorite
      });
    });
  },

  toggleNearbyCategory(event) {
    const category = event.currentTarget.dataset.category;
    const nearbyCategories = getActiveCategoriesForFilter(category);

    this.setData({
      nearbyFilter: category,
      nearbyCategories,
      nearbyCategoryTabs: createCategoryTabs(category)
    }, () => {
      this.refreshNearbyPlaces();
    });
  },

  refreshNearbyPlaces() {
    if (!this.data.place) {
      this.setData({ nearbyPlaces: [] });
      return;
    }

    const nearbyPlaces = getNearbyPlaces(this.data.place, this.data.allPlaces, {
      radiusKm: 2,
      categories: this.data.nearbyCategories
    }).map((place) => withCategoryMeta({
      ...place,
      distanceText: `${place.distanceKm.toFixed(1)} 公里`
    }));

    this.setData({ nearbyPlaces });
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
