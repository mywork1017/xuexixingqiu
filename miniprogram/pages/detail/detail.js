const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getDistanceText,
  getPlaceDisplayPhotos,
  getPlaceVisualMeta,
  getNearbyPlaces,
  normalizePlace,
  placesToMarkers
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');
const { getLocalFavoriteIds, loadFavoriteIds, toggleFavoriteId } = require('../../utils/favorite-store');
const { MAP_STYLE_CONFIG } = require('../../config/map-style');

const MAP_DOT_CANVAS_SIZE = 48;
const SELECTED_LABEL_FONT_SIZE = 13;
const SELECTED_LABEL_PADDING_X = 28;
const SELECTED_LABEL_HEIGHT = 44;
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
  context.font = `400 ${SELECTED_LABEL_FONT_SIZE}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, 0.95)';
  context.shadowBlur = 18;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 3;
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

function withCategoryMeta(place, usage = 'detail') {
  const meta = getPlaceVisualMeta(place.category);
  const displayHours = place.name === '思南书局' ? '10:00-21:00　全年无休' : (place.hours || '以现场公示为准');
  const displayDescription = place.name === '思南书局'
    ? '坐落在思南公馆内的独立书店，藏书丰富，适合阅读与慢慢逛书。'
    : place.description;
  return {
    ...place,
    categoryColor: meta.color,
    categoryShortName: meta.shortName,
    detailMainAvatarPath: meta.detailMainAvatarPath,
    nearbyAvatarPath: meta.nearbyAvatarPath,
    displayPhotos: getPlaceDisplayPhotos(place),
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
    mapStyle: MAP_STYLE_CONFIG,
    mapScrimPolygons: MAP_SCRIM_POLYGONS,
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
      mapMarkers: placesToMarkers([place], { selectedPlaceId: place.id, markerUsage: 'detail-map' }),
      favoritePlaceIds,
      isFavorite: favoritePlaceIds.indexOf(place.id) >= 0
    }, () => {
      this.refreshNearbyPlaces();
      this.prepareDetailMapDotIcon(place);
    });
  },

  prepareDetailMapDotIcon(place) {
    const meta = getPlaceVisualMeta(place.category);
    Promise.all([
      drawMapDotIcon(meta.mapMarkerColor),
      drawSelectedLabelIcon(place.name)
    ]).then(([iconPath, labelIcon]) => {
      this.setData({
        mapMarkers: placesToMarkers([place], {
          selectedPlaceId: place.id,
          markerUsage: 'detail-map',
          mapDotIconPaths: {
            [place.category]: iconPath
          },
          selectedLabelIcon: {
            ...labelIcon,
            placeId: place.id
          }
        })
      });
    }).catch(() => {});
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
      distanceText: getDistanceText(place.distanceKm)
    }, 'nearby'));

    this.setData({ nearbyPlaces });
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
