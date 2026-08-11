const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getDistanceText,
  getPlaceDisplayAddress,
  getPlaceDisplayHours,
  getPlaceNavigationLabel,
  getPlaceDisplayPhotos,
  getNearbyPlaces,
  isExcludedPlaceType,
  normalizePlace,
  sanitizePlaceDescription
} = require('../../utils/place-utils');
const { drawMapDotIcon } = require('../../utils/map-dot-icon');

function createCategoryTabs(activeFilter) {
  return CATEGORY_FILTER_OPTIONS.map((category) => ({
    name: category,
    markerStyle: category === '全部' ? '' : CATEGORY_META[category].markerStyle,
    active: activeFilter === category
  }));
}

function withCategoryMeta(place) {
  const displayDescription = sanitizePlaceDescription(place.description) || '—';
  const categoryMeta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
  return {
    ...place,
    displayAddress: getPlaceDisplayAddress(place),
    displayPhotos: getPlaceDisplayPhotos(place).slice(0, 5),
    displayDescription,
    displayHours: getPlaceDisplayHours(place),
    markerStyle: categoryMeta.markerStyle,
    navigationLabel: getPlaceNavigationLabel(place)
  };
}

Page({
  data: {
    navMetrics: getApp().getNavMetrics(),
    place: null,
    allPlaces: [],
    nearbyFilter: '全部',
    nearbyCategories: CATEGORY_OPTIONS,
    nearbyCategoryTabs: createCategoryTabs('全部'),
    nearbyPlaces: [],
    detailMapMarkers: []
  },

  onLoad(options) {
    const placeId = decodeURIComponent(options.id || '');
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) ? cachedPlaces : [];
    const normalizedPlaces = places.map(normalizePlace).filter((place) => !isExcludedPlaceType(place));
    const place = normalizedPlaces.find((item) => item.id === placeId);
    if (!place) {
      wx.showToast({
        title: '地点不存在',
        icon: 'none'
      });
      return;
    }

    this.setData({
      place: withCategoryMeta(place),
      allPlaces: normalizedPlaces
    }, () => {
      this.refreshNearbyPlaces();
      this.prepareDetailMapMarker(place);
    });
  },

  prepareDetailMapMarker(place) {
    const categoryMeta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
    drawMapDotIcon(categoryMeta).then((iconPath) => {
      if (!this.data.place || this.data.place.id !== place.id) {
        return;
      }
      this.setData({
        detailMapMarkers: [{
          id: 1,
          latitude: place.latitude,
          longitude: place.longitude,
          iconPath,
          width: 22,
          height: 22,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: 10
        }]
      });
    }).catch(() => {
      this.setData({ detailMapMarkers: [] });
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.reLaunch({
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
      distanceText: getDistanceText(place.distanceKm)
    }));

    this.setData({ nearbyPlaces });
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
