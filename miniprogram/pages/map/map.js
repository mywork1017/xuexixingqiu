const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getDistanceKm,
  getDistanceText,
  getDisplayPlaces,
  getPlaceVisualMeta,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const { getLocalFavoriteIds, loadFavoriteIds, toggleFavoriteId } = require('../../utils/favorite-store');
const { MAP_STYLE_CONFIG } = require('../../config/map-style');

const FEATURED_PLACE_NAME = '思南书局';
const MAP_DOT_CANVAS_SIZE = 48;
const USER_LOCATION_CANVAS_SIZE = 32;
const SELECTED_LABEL_FONT_SIZE = 11;
const SELECTED_LABEL_PADDING_X = 30;
const SELECTED_LABEL_HEIGHT = 46;
const SHANGHAI_CENTER_LOCATION = {
  latitude: 31.2304,
  longitude: 121.4737
};
const MAP_SCRIM_POLYGONS = [{
  points: [
    { latitude: 85, longitude: -180 },
    { latitude: 85, longitude: 180 },
    { latitude: -85, longitude: 180 },
    { latitude: -85, longitude: -180 }
  ],
  fillColor: '#00000047',
  strokeColor: '#00000000',
  strokeWidth: 0,
  zIndex: 20
}];

function createCategoryTabs(activeFilter) {
  const chipWidths = {
    全部: 92,
    图书馆: 150,
    书店: 126,
    自习室: 150,
    党群服务中心: 218,
    社区食堂: 188
  };

  return CATEGORY_FILTER_OPTIONS.map((category) => ({
    name: category,
    color: category === '全部' ? '#d2a66b' : CATEGORY_META[category].color,
    width: chipWidths[category] || 132,
    active: activeFilter === category
  }));
}

function getPageNavMetrics() {
  const navMetrics = getApp().getNavMetrics();
  const filterTopGap = 2;
  const filterHeight = 44;
  return {
    ...navMetrics,
    filterTop: navMetrics.topOffset + filterTopGap,
    filterHeight,
    headerHeight: navMetrics.topOffset + filterTopGap + filterHeight
  };
}

function getFeaturedPlace(places) {
  return places.find((place) => place.name === FEATURED_PLACE_NAME) || places[0] || null;
}

function getNearestPlace(places, location) {
  const origin = location || SHANGHAI_CENTER_LOCATION;
  const nearest = places
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .map((place) => ({
      place,
      distanceKm: getDistanceKm(origin, place)
    }))
    .sort((first, second) => first.distanceKm - second.distanceKm)[0];

  return nearest ? nearest.place : getFeaturedPlace(places);
}

function includeSelectedPlace(displayPlaces, selectedPlace) {
  if (!selectedPlace || displayPlaces.some((place) => place.id === selectedPlace.id)) {
    return displayPlaces;
  }

  return [selectedPlace, ...displayPlaces];
}

function withDisplayMeta(place) {
  if (!place) {
    return null;
  }
  const meta = getPlaceVisualMeta(place.category);
  const displayHours = place.name === '思南书局' ? '10:00-21:00　营业中' : (place.hours || '以现场公示为准');

  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    mapCardAvatarPath: meta.mapCardAvatarPath,
    displayHours
  };
}

function drawMapDotIcon(color) {
  if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
    return Promise.reject(new Error('canvas api unavailable'));
  }

  const canvas = wx.createOffscreenCanvas({
    type: '2d',
    width: MAP_DOT_CANVAS_SIZE,
    height: MAP_DOT_CANVAS_SIZE
  });
  const context = canvas.getContext('2d');
  const center = MAP_DOT_CANVAS_SIZE / 2;

  context.clearRect(0, 0, MAP_DOT_CANVAS_SIZE, MAP_DOT_CANVAS_SIZE);
  context.beginPath();
  context.arc(center, center, 17, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = '#ffffff';
  context.stroke();

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: MAP_DOT_CANVAS_SIZE,
      height: MAP_DOT_CANVAS_SIZE,
      destWidth: MAP_DOT_CANVAS_SIZE,
      destHeight: MAP_DOT_CANVAS_SIZE,
      fileType: 'png',
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

function drawUserLocationIcon() {
  if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
    return Promise.reject(new Error('canvas api unavailable'));
  }

  const canvas = wx.createOffscreenCanvas({
    type: '2d',
    width: USER_LOCATION_CANVAS_SIZE,
    height: USER_LOCATION_CANVAS_SIZE
  });
  const context = canvas.getContext('2d');
  const center = USER_LOCATION_CANVAS_SIZE / 2;

  context.clearRect(0, 0, USER_LOCATION_CANVAS_SIZE, USER_LOCATION_CANVAS_SIZE);
  context.beginPath();
  context.arc(center, center, 8, 0, Math.PI * 2);
  context.fillStyle = 'rgba(24, 174, 234, 0.42)';
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(255, 255, 255, 0.46)';
  context.stroke();

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: USER_LOCATION_CANVAS_SIZE,
      height: USER_LOCATION_CANVAS_SIZE,
      destWidth: USER_LOCATION_CANVAS_SIZE,
      destHeight: USER_LOCATION_CANVAS_SIZE,
      fileType: 'png',
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

function drawSelectedLabelIcon(text) {
  if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
    return Promise.reject(new Error('canvas api unavailable'));
  }

  const content = String(text || '');
  const width = Math.max(96, content.length * SELECTED_LABEL_FONT_SIZE + SELECTED_LABEL_PADDING_X * 2);
  const height = SELECTED_LABEL_HEIGHT;
  const canvas = wx.createOffscreenCanvas({
    type: '2d',
    width,
    height
  });
  const context = canvas.getContext('2d');

  context.clearRect(0, 0, width, height);
  context.font = `300 ${SELECTED_LABEL_FONT_SIZE}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, 1)';
  context.shadowBlur = 28;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 5;
  context.fillStyle = '#F4EAD8';
  context.fillText(content, width / 2, height / 2);
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'png',
      success: (res) => resolve({
        placeId: '',
        path: res.tempFilePath,
        width,
        height
      }),
      fail: reject
    });
  });
}

Page({
  data: {
    latitude: SHANGHAI_CENTER_LOCATION.latitude,
    longitude: SHANGHAI_CENTER_LOCATION.longitude,
    scale: 11,
    mapStyle: MAP_STYLE_CONFIG,
    mapScrimPolygons: MAP_SCRIM_POLYGONS,
    navMetrics: getPageNavMetrics(),
    categoryTabs: createCategoryTabs('全部'),
    activeFilter: '全部',
    activeCategories: CATEGORY_OPTIONS,
    places: [],
    displayPlaces: [],
    markers: [],
    mapDotIconPaths: {},
    userLocationIconPath: '',
    selectedLabelIcon: null,
    selectedPlace: null,
    favoritePlaceIds: [],
    userLocation: null,
    initialSelectionLocation: SHANGHAI_CENTER_LOCATION,
    iconsReady: false,
    loading: true,
    loadError: '',
    noResultsInView: false,
    visibleBounds: null
  },

  onLoad() {
    Promise.all([
      Promise.all([
        this.prepareMapDotIcons().catch(() => null),
        this.prepareUserLocationIcon().catch(() => null)
      ]),
      this.resolveInitialSelectionLocation()
    ]).then(() => {
      this.loadPlaces();
    });
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

    if (!this.data.places.length && this.data.iconsReady) {
      this.refreshFromCache();
    }
  },

  resolveInitialSelectionLocation() {
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (location) => {
          const userLocation = {
            latitude: location.latitude,
            longitude: location.longitude
          };
          this.setData({
            userLocation,
            initialSelectionLocation: userLocation
          }, resolve);
        },
        fail: () => {
          this.setData({
            initialSelectionLocation: SHANGHAI_CENTER_LOCATION
          }, resolve);
        }
      });
    });
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
    const selectedPlace = getNearestPlace(places, this.data.initialSelectionLocation);

    wx.setStorageSync('places', places);
    this.setData({
      places,
      latitude: selectedPlace ? selectedPlace.latitude : this.data.latitude,
      longitude: selectedPlace ? selectedPlace.longitude : this.data.longitude,
      selectedPlace: this.withFavoriteState(selectedPlace),
      loadError: loadError || ''
    }, () => {
      this.updateVisibleMarkers();
      this.prepareSelectedLabelIcon(selectedPlace);
    });
  },

  withFavoriteState(place, favoritePlaceIds, userLocation) {
    if (!place) {
      return null;
    }
    const ids = favoritePlaceIds || this.data.favoritePlaceIds;
    const displayPlace = withDisplayMeta(place);
    const currentLocation = userLocation || this.data.userLocation;
    const distanceKm = currentLocation
      ? getDistanceKm(currentLocation, displayPlace)
      : null;

    return {
      ...displayPlace,
      distanceText: getDistanceText(distanceKm),
      isFavorite: ids.indexOf(place.id) >= 0
    };
  },

  prepareMapDotIcons() {
    const iconTasks = CATEGORY_OPTIONS.map((category) => {
      const meta = getPlaceVisualMeta(category);
      return drawMapDotIcon(meta.mapMarkerColor).then((iconPath) => [category, iconPath]);
    });

    return Promise.all(iconTasks).then((entries) => {
      const mapDotIconPaths = entries.reduce((paths, entry) => {
        paths[entry[0]] = entry[1];
        return paths;
      }, {});
      this.setData({ mapDotIconPaths, iconsReady: true }, () => {
        if (this.data.places.length) {
          this.updateVisibleMarkers();
        }
      });
      return mapDotIconPaths;
    });
  },

  prepareUserLocationIcon() {
    return drawUserLocationIcon().then((iconPath) => {
      this.setData({ userLocationIconPath: iconPath });
      return iconPath;
    });
  },

  prepareSelectedLabelIcon(place) {
    if (!place) {
      this.setData({ selectedLabelIcon: null });
      return Promise.resolve(null);
    }

    return drawSelectedLabelIcon(place.name).then((labelIcon) => {
      const selectedLabelIcon = {
        ...labelIcon,
        placeId: place.id
      };
      this.setData({ selectedLabelIcon }, () => {
        this.updateVisibleMarkers();
      });
      return selectedLabelIcon;
    }).catch(() => null);
  },

  createMarkers(displayPlaces) {
    const markers = placesToMarkers(displayPlaces, {
      selectedPlaceId: this.data.selectedPlace && this.data.selectedPlace.id,
      mapDotIconPaths: this.data.mapDotIconPaths,
      selectedLabelIcon: this.data.selectedLabelIcon,
      allPlaceIds: this.data.places.map((place) => place.id)
    });

    if (this.data.userLocation && this.data.userLocationIconPath) {
      return [{
        id: 900000,
        markerType: 'user-location',
        latitude: this.data.userLocation.latitude,
        longitude: this.data.userLocation.longitude,
        iconPath: this.data.userLocationIconPath,
        width: 16,
        height: 16,
        anchor: { x: 0.5, y: 0.5 },
        zIndex: 2
      }, ...markers];
    }

    return markers;
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
      this.ignoreNextMapTap = true;
      this.setData({
        selectedPlace: this.withFavoriteState(selectedPlace),
        selectedLabelIcon: null
      }, () => {
        this.setData({ markers: this.createMarkers(this.data.displayPlaces) });
        this.prepareSelectedLabelIcon(selectedPlace);
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
        selectedLabelIcon: null
      }, () => {
        this.setData({
          markers: this.createMarkers(this.data.displayPlaces)
        });
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
          const visiblePlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            bounds: region,
            scale
          });
          const selectedPlace = this.data.selectedPlace;
          const displayPlaces = includeSelectedPlace(visiblePlaces, selectedPlace);

          const nextData = {
            visibleBounds: region,
            displayPlaces,
            selectedPlace: this.withFavoriteState(selectedPlace),
            noResultsInView: !this.data.loading && this.data.places.length > 0 && visiblePlaces.length === 0,
            markers: this.createMarkers(displayPlaces)
          };
          this.setData(nextData);
        },
        fail: () => {
          const visiblePlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            scale
          });
          const selectedPlace = this.data.selectedPlace;
          const displayPlaces = includeSelectedPlace(visiblePlaces, selectedPlace);

          const nextData = {
            displayPlaces,
            selectedPlace: this.withFavoriteState(selectedPlace),
            noResultsInView: !this.data.loading && this.data.places.length > 0 && visiblePlaces.length === 0,
            markers: this.createMarkers(displayPlaces)
          };
          this.setData(nextData);
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
    this.setData({
      latitude: SHANGHAI_CENTER_LOCATION.latitude,
      longitude: SHANGHAI_CENTER_LOCATION.longitude,
      scale: this.data.scale
    }, () => {
      this.updateVisibleMarkers();
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
