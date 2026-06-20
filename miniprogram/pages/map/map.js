const {
  CATEGORY_OPTIONS,
  CATEGORY_META,
  getDisplayPlaces,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');

const FAVORITES_KEY = 'favoritePlaceIds';
const SELECTED_POINT_VERTICAL_OFFSET_RATIO = 0.18;

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

function getMarkerCenterForUpperDisplay(place, bounds) {
  const latitudeSpan = bounds && bounds.northeast && bounds.southwest
    ? Math.abs(bounds.northeast.latitude - bounds.southwest.latitude)
    : 0.03;

  return {
    latitude: place.latitude - latitudeSpan * SELECTED_POINT_VERTICAL_OFFSET_RATIO,
    longitude: place.longitude
  };
}

Page({
  data: {
    latitude: 31.2304,
    longitude: 121.4737,
    scale: 11,
    categoryTabs: createCategoryTabs(CATEGORY_OPTIONS),
    activeCategories: CATEGORY_OPTIONS,
    places: [],
    displayPlaces: [],
    markers: [],
    selectedPlace: null,
    favoritePlaceIds: [],
    loading: true,
    loadError: '',
    visibleBounds: null
  },

  onLoad() {
    this.loadPlaces();
  },

  onShow() {
    const favoritePlaceIds = getStoredFavoriteIds();
    this.setData({
      favoritePlaceIds,
      selectedPlace: this.withFavoriteState(this.data.selectedPlace, favoritePlaceIds)
    });
    if (!this.data.places.length) {
      this.refreshFromCache();
    }
  },

  refreshFromCache() {
    const places = wx.getStorageSync('places');
    if (Array.isArray(places) && places.length) {
      this.applyPlaces(places);
    }
  },

  loadPlaces() {
    this.setData({ loading: true, loadError: '' });

    if (wx.cloud) {
      wx.cloud.callFunction({
        name: 'getPlaces',
        data: {},
        success: (res) => {
          const cloudPlaces = res.result && Array.isArray(res.result.data) ? res.result.data : [];
          this.applyPlaces(cloudPlaces.length ? cloudPlaces : SAMPLE_PLACES);
        },
        fail: () => {
          this.applyPlaces(SAMPLE_PLACES, '已显示本地地点');
        },
        complete: () => {
          this.setData({ loading: false });
        }
      });
      return;
    }

    this.applyPlaces(SAMPLE_PLACES);
    this.setData({ loading: false });
  },

  applyPlaces(rawPlaces, loadError) {
    const places = rawPlaces.map(normalizePlace);

    wx.setStorageSync('places', places);
    this.setData({
      places,
      selectedPlace: null,
      loadError: loadError || ''
    }, () => {
      this.updateVisibleMarkers();
    });
  },

  withFavoriteState(place, favoritePlaceIds) {
    if (!place) {
      return null;
    }
    const ids = favoritePlaceIds || this.data.favoritePlaceIds;
    return {
      ...place,
      isFavorite: ids.indexOf(place.id) >= 0
    };
  },

  toggleCategory(event) {
    const category = event.currentTarget.dataset.category;
    const activeCategories = this.data.activeCategories.slice();
    const existingIndex = activeCategories.indexOf(category);

    if (existingIndex >= 0) {
      activeCategories.splice(existingIndex, 1);
    } else {
      activeCategories.push(category);
    }

    this.setData({
      activeCategories,
      categoryTabs: createCategoryTabs(activeCategories),
      selectedPlace: null
    }, () => {
      this.updateVisibleMarkers();
    });
  },

  onMarkerTap(event) {
    const marker = this.data.markers.find((item) => item.id === event.markerId);
    if (!marker) {
      return;
    }

    const selectedPlace = this.data.displayPlaces.find((place) => place.id === marker.placeId);
    if (selectedPlace) {
      const center = getMarkerCenterForUpperDisplay(selectedPlace, this.data.visibleBounds);
      this.ignoreNextMapTap = true;
      this.setData({
        latitude: center.latitude,
        longitude: center.longitude,
        selectedPlace: this.withFavoriteState(selectedPlace),
        markers: placesToMarkers(this.data.displayPlaces, { selectedPlaceId: selectedPlace.id })
      });
    }
  },

  onMapTap() {
    if (this.ignoreNextMapTap) {
      this.ignoreNextMapTap = false;
      return;
    }

    if (this.data.selectedPlace) {
      this.setData({
        selectedPlace: null,
        markers: placesToMarkers(this.data.displayPlaces)
      });
    }
  },

  onRegionChange(event) {
    if (event.type === 'end') {
      this.updateVisibleMarkers();
    }
  },

  updateVisibleMarkers() {
    const map = wx.createMapContext('studyMap');
    const applyRegion = (scale) => {
      map.getRegion({
        success: (region) => {
          const displayPlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            bounds: region,
            scale
          });

          this.setData({
            visibleBounds: region,
            displayPlaces,
            markers: placesToMarkers(displayPlaces, {
              selectedPlaceId: this.data.selectedPlace && this.data.selectedPlace.id
            })
          });
        },
        fail: () => {
          const displayPlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            scale
          });

          this.setData({
            displayPlaces,
            markers: placesToMarkers(displayPlaces, {
              selectedPlaceId: this.data.selectedPlace && this.data.selectedPlace.id
            })
          });
        }
      });
    };

    if (typeof map.getScale === 'function') {
      map.getScale({
        success: (res) => {
          applyRegion(Number(res.scale || this.data.scale));
        },
        fail: () => {
          applyRegion(this.data.scale);
        }
      });
      return;
    }

    applyRegion(this.data.scale);
  },

  moveToUserLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (location) => {
        this.setData({
          latitude: location.latitude,
          longitude: location.longitude
        }, () => {
          this.updateVisibleMarkers();
        });

        const map = wx.createMapContext('studyMap');
        map.moveToLocation({
          latitude: location.latitude,
          longitude: location.longitude
        });
      },
      fail: () => {
        wx.showToast({
          title: '无法获取位置',
          icon: 'none'
        });
      }
    });
  },

  openLocation(event) {
    const placeId = event.currentTarget.dataset.id || (this.data.selectedPlace && this.data.selectedPlace.id);
    const place = this.data.places.find((item) => item.id === placeId);
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

  toggleFavorite(event) {
    const placeId = event.currentTarget.dataset.id || (this.data.selectedPlace && this.data.selectedPlace.id);
    if (!placeId) {
      return;
    }

    const favoritePlaceIds = this.data.favoritePlaceIds.slice();
    const existingIndex = favoritePlaceIds.indexOf(placeId);

    if (existingIndex >= 0) {
      favoritePlaceIds.splice(existingIndex, 1);
    } else {
      favoritePlaceIds.push(placeId);
    }

    wx.setStorageSync(FAVORITES_KEY, favoritePlaceIds);
    this.setData({
      favoritePlaceIds,
      selectedPlace: this.withFavoriteState(this.data.selectedPlace, favoritePlaceIds)
    });
  },

  goToDetail(event) {
    const placeId = event.currentTarget.dataset.id || (this.data.selectedPlace && this.data.selectedPlace.id);
    if (!placeId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(placeId)}`
    });
  }
});
