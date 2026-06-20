const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getDisplayPlaces,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const { getLocalFavoriteIds, loadFavoriteIds, toggleFavoriteId } = require('../../utils/favorite-store');

const SELECTED_POINT_VERTICAL_OFFSET_RATIO = 0.18;
const FEATURED_PLACE_NAME = '思南书局';

function createCategoryTabs(activeFilter) {
  const chipWidths = {
    全部: 92,
    图书馆: 132,
    书店: 116,
    自习室: 132,
    党群服务中心: 190,
    社区食堂: 164
  };

  return CATEGORY_FILTER_OPTIONS.map((category) => ({
    name: category,
    color: category === '全部' ? '#d2a66b' : CATEGORY_META[category].color,
    width: chipWidths[category] || 132,
    active: activeFilter === category
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

function getFeaturedPlace(places) {
  return places.find((place) => place.name === FEATURED_PLACE_NAME) || places[0] || null;
}

function withDisplayMeta(place) {
  if (!place) {
    return null;
  }
  const meta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
  const displayHours = place.name === '思南书局' ? '10:00-21:00　营业中' : (place.hours || '以现场公示为准');

  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    displayHours
  };
}

Page({
  data: {
    latitude: 31.2304,
    longitude: 121.4737,
    scale: 11,
    navMetrics: getApp().getNavMetrics(),
    categoryTabs: createCategoryTabs('全部'),
    activeFilter: '全部',
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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }

    const favoritePlaceIds = getLocalFavoriteIds();
    this.setData({
      favoritePlaceIds,
      selectedPlace: this.withFavoriteState(this.data.selectedPlace, favoritePlaceIds)
    });

    loadFavoriteIds().then((syncedIds) => {
      this.setData({
        favoritePlaceIds: syncedIds,
        selectedPlace: this.withFavoriteState(this.data.selectedPlace, syncedIds)
      });
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
    const selectedPlace = getFeaturedPlace(places);

    wx.setStorageSync('places', places);
    this.setData({
      places,
      latitude: selectedPlace ? selectedPlace.latitude : this.data.latitude,
      longitude: selectedPlace ? selectedPlace.longitude : this.data.longitude,
      selectedPlace: this.withFavoriteState(selectedPlace),
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
      ...withDisplayMeta(place),
      isFavorite: ids.indexOf(place.id) >= 0
    };
  },

  toggleCategory(event) {
    const category = event.currentTarget.dataset.category;
    const activeCategories = getActiveCategoriesForFilter(category);

    this.setData({
      activeFilter: category,
      activeCategories,
      categoryTabs: createCategoryTabs(category),
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

    toggleFavoriteId(placeId).then(({ favoriteIds }) => {
      this.setData({
        favoritePlaceIds: favoriteIds,
        selectedPlace: this.withFavoriteState(this.data.selectedPlace, favoriteIds)
      });
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
