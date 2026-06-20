const {
  CATEGORY_OPTIONS,
  CATEGORY_META,
  getNearbyPlaces,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');

const FAVORITES_KEY = 'favoritePlaceIds';

function getStoredFavoriteIds() {
  const ids = wx.getStorageSync(FAVORITES_KEY);
  return Array.isArray(ids) ? ids : [];
}

function createCategoryTabs(activeCategories) {
  return CATEGORY_OPTIONS.map((category) => ({
    name: category,
    color: CATEGORY_META[category].color,
    active: activeCategories.indexOf(category) >= 0
  }));
}

Page({
  data: {
    place: null,
    allPlaces: [],
    mapMarkers: [],
    favoritePlaceIds: [],
    isFavorite: false,
    nearbyOpen: false,
    nearbySummary: '可展开查看附近地点',
    nearbyCategories: CATEGORY_OPTIONS,
    nearbyCategoryTabs: createCategoryTabs(CATEGORY_OPTIONS),
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

    wx.setNavigationBarTitle({
      title: place.name
    });
    const favoritePlaceIds = getStoredFavoriteIds();
    this.setData({
      place,
      allPlaces: normalizedPlaces,
      mapMarkers: placesToMarkers([place]),
      favoritePlaceIds,
      isFavorite: favoritePlaceIds.indexOf(place.id) >= 0
    }, () => {
      this.refreshNearbyPlaces();
    });
  },

  onShow() {
    const favoritePlaceIds = getStoredFavoriteIds();
    this.setData({
      favoritePlaceIds,
      isFavorite: this.data.place ? favoritePlaceIds.indexOf(this.data.place.id) >= 0 : false
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

  callPhone() {
    const { place } = this.data;
    if (!place || !place.phone) {
      return;
    }

    wx.makePhoneCall({
      phoneNumber: place.phone
    });
  },

  toggleFavorite() {
    const { place } = this.data;
    if (!place) {
      return;
    }

    const favoritePlaceIds = this.data.favoritePlaceIds.slice();
    const existingIndex = favoritePlaceIds.indexOf(place.id);

    if (existingIndex >= 0) {
      favoritePlaceIds.splice(existingIndex, 1);
    } else {
      favoritePlaceIds.push(place.id);
    }

    wx.setStorageSync(FAVORITES_KEY, favoritePlaceIds);
    this.setData({
      favoritePlaceIds,
      isFavorite: favoritePlaceIds.indexOf(place.id) >= 0
    });
  },

  toggleNearby() {
    this.setData({
      nearbyOpen: !this.data.nearbyOpen
    }, () => {
      this.refreshNearbyPlaces();
    });
  },

  toggleNearbyCategory(event) {
    const category = event.currentTarget.dataset.category;
    const nearbyCategories = this.data.nearbyCategories.slice();
    const existingIndex = nearbyCategories.indexOf(category);

    if (existingIndex >= 0) {
      nearbyCategories.splice(existingIndex, 1);
    } else {
      nearbyCategories.push(category);
    }

    this.setData({
      nearbyCategories,
      nearbyCategoryTabs: createCategoryTabs(nearbyCategories)
    }, () => {
      this.refreshNearbyPlaces();
    });
  },

  refreshNearbyPlaces() {
    if (!this.data.place || !this.data.nearbyOpen) {
      this.setData({
        nearbyPlaces: [],
        nearbySummary: '可展开查看附近地点'
      });
      return;
    }

    const nearbyPlaces = getNearbyPlaces(this.data.place, this.data.allPlaces, {
        radiusKm: 2,
        categories: this.data.nearbyCategories
      }).map((place) => ({
        ...place,
        distanceText: place.distanceKm.toFixed(1)
      }));

    this.setData({
      nearbyPlaces,
      nearbySummary: `${nearbyPlaces.length} 个地点`
    });
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
