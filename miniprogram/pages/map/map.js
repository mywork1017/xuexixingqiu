const {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  getActiveCategoriesForFilter,
  getBoundsInsideVerticalOverlays,
  getDistanceKm,
  getDistanceText,
  getDisplayPlaces,
  getPlaceDisplayAddress,
  getPlaceDisplayHours,
  getPlaceNavigationLabel,
  getPlaceVisualMeta,
  isExcludedPlaceType,
  isPlaceInBounds,
  normalizePlace,
  orderPlacesByProximity,
  placesToMarkers
} = require('../../utils/place-utils');
const { drawMapDotIcon } = require('../../utils/map-dot-icon');
const {
  SHANGHAI_CENTER_LOCATION,
  isRegionOutsideShanghai,
  isWithinShanghaiBounds
} = require('../../utils/location-utils');

const FEATURED_PLACE_NAME = '上海图书馆东馆';
const USER_LOCATION_CANVAS_SIZE = 32;
const SELECTED_MARKER_BREATH_INTERVAL_MS = 150;
const SELECTED_MARKER_BREATH_CYCLE_MS = 1800;
const SELECTED_MARKER_MIN_SIZE = 39;
const SELECTED_MARKER_MAX_SIZE = 47;
const CARD_SWIPE_DURATION_MS = 200;
const BOTTOM_SHEET_OCCLUDED_RPX = 342;
const MARKER_EDGE_GUARD_PX = 28;
function createCategoryTabs(activeFilter) {
  return CATEGORY_FILTER_OPTIONS.map((category) => ({
    name: category,
    markerStyle: category === '全部' ? '' : CATEGORY_META[category].markerStyle,
    active: activeFilter === category
  }));
}

function getPageNavMetrics() {
  const navMetrics = getApp().getNavMetrics();
  const contentOffset = 16;
  const filterTopGap = 18;
  const filterHeight = 44;
  return {
    ...navMetrics,
    contentOffset,
    filterTop: navMetrics.topOffset + filterTopGap,
    filterHeight,
    headerHeight: navMetrics.topOffset + filterTopGap + filterHeight
  };
}

function getMapVerticalOcclusionRatios(navMetrics, cardVisible) {
  try {
    const windowInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const rpxToPx = Number(windowInfo.windowWidth || 375) / 750;
    const safeAreaBottom = windowInfo.safeArea
      ? Math.max(0, Number(windowInfo.windowHeight || 0) - Number(windowInfo.safeArea.bottom || 0))
      : 0;
    const windowHeight = Number(windowInfo.windowHeight || 667);
    const bottomCoveredHeight = cardVisible
      ? (BOTTOM_SHEET_OCCLUDED_RPX * rpxToPx) + safeAreaBottom + MARKER_EDGE_GUARD_PX
      : 0;
    return {
      top: Math.min((Number(navMetrics.headerHeight || 0) + MARKER_EDGE_GUARD_PX) / windowHeight, 0.45),
      bottom: Math.min(bottomCoveredHeight / windowHeight, 0.45)
    };
  } catch (error) {
    return { top: 0.18, bottom: cardVisible ? 0.28 : 0 };
  }
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

function withDisplayMeta(place) {
  if (!place) {
    return null;
  }
  return {
    ...place,
    displayAddress: getPlaceDisplayAddress(place),
    displayHours: getPlaceDisplayHours(place),
    navigationLabel: getPlaceNavigationLabel(place)
  };
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

Page({
  data: {
    latitude: SHANGHAI_CENTER_LOCATION.latitude,
    longitude: SHANGHAI_CENTER_LOCATION.longitude,
    scale: 13,
    navMetrics: getPageNavMetrics(),
    categoryTabs: createCategoryTabs('全部'),
    activeFilter: '全部',
    activeCategories: CATEGORY_OPTIONS,
    places: [],
    displayPlaces: [],
    markerPlaceIds: [],
    markers: [],
    mapDotIconPaths: {},
    selectedMapDotIconPaths: {},
    userLocationIconPath: '',
    selectedPlace: null,
    selectedPlaceIndex: 0,
    userLocation: null,
    initialSelectionLocation: SHANGHAI_CENTER_LOCATION,
    iconsReady: false,
    loading: true,
    loadError: '',
    noResultsInView: false,
    emptyStateText: '附近没有结果',
    locating: false,
    cardSwipeDuration: CARD_SWIPE_DURATION_MS,
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
    this.startSelectedMarkerBreathing();
    if (!this.data.places.length && this.data.iconsReady) {
      this.refreshFromCache();
    }
  },

  onHide() {
    this.stopSelectedMarkerBreathing();
  },

  onUnload() {
    this.stopSelectedMarkerBreathing();
  },

  startSelectedMarkerBreathing() {
    this.stopSelectedMarkerBreathing();
    this.selectedMarkerBreathStartedAt = Date.now();
    this.selectedMarkerBreathTimer = setInterval(() => {
      const selectedPlaceId = this.data.selectedPlace && this.data.selectedPlace.id;
      if (!selectedPlaceId) {
        return;
      }

      const markerIndex = this.data.markers.findIndex((marker) => marker.placeId === selectedPlaceId);
      if (markerIndex < 0) {
        return;
      }

      const elapsed = Date.now() - this.selectedMarkerBreathStartedAt;
      const progress = (elapsed % SELECTED_MARKER_BREATH_CYCLE_MS) / SELECTED_MARKER_BREATH_CYCLE_MS;
      const intensity = (1 - Math.cos(progress * Math.PI * 2)) / 2;
      const size = Math.round(
        SELECTED_MARKER_MIN_SIZE
        + ((SELECTED_MARKER_MAX_SIZE - SELECTED_MARKER_MIN_SIZE) * intensity)
      );
      if (this.selectedMarkerBreathSize === size) {
        return;
      }
      this.selectedMarkerBreathSize = size;

      const markerPath = `markers[${markerIndex}]`;
      this.setData({
        [`${markerPath}.width`]: size,
        [`${markerPath}.height`]: size
      });
    }, SELECTED_MARKER_BREATH_INTERVAL_MS);
  },

  stopSelectedMarkerBreathing() {
    if (this.selectedMarkerBreathTimer) {
      clearInterval(this.selectedMarkerBreathTimer);
      this.selectedMarkerBreathTimer = null;
    }
    this.selectedMarkerBreathSize = null;
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
          this.recordLocationVisit(location, 'page_open').then((visit) => {
            const isShanghai = visit.isShanghai;
            this.setData({
              userLocation: isShanghai ? userLocation : null,
              initialSelectionLocation: isShanghai ? userLocation : SHANGHAI_CENTER_LOCATION
            }, resolve);
          });
        },
        fail: () => {
          this.setData({
            userLocation: null,
            initialSelectionLocation: SHANGHAI_CENTER_LOCATION
          }, resolve);
        }
      });
    });
  },

  recordLocationVisit(location, source) {
    const fallback = {
      isShanghai: isWithinShanghaiBounds(location),
      city: isWithinShanghaiBounds(location) ? '上海市' : '',
      district: ''
    };
    if (!wx.cloud) return Promise.resolve(fallback);

    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'recordVisit',
        data: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          source
        },
        success: (res) => {
          const result = res.result || {};
          resolve(result.ok ? {
            isShanghai: Boolean(result.isShanghai),
            city: result.city || '',
            district: result.district || ''
          } : fallback);
        },
        fail: () => resolve(fallback)
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
          this.applyPlaces(cloudPlaces, cloudPlaces.length ? '' : '后台暂无已发布地点');
        },
        fail: () => {
          this.applyPlaces([], '地点加载失败，请稍后重试');
        },
        complete: () => {
          this.setData({ loading: false });
        }
      });
      return;
    }

    this.applyPlaces([], '当前环境无法连接地点后台');
    this.setData({ loading: false });
  },

  applyPlaces(rawPlaces, loadError) {
    const places = rawPlaces.map(normalizePlace).filter((place) => !isExcludedPlaceType(place));
    const selectedPlace = getNearestPlace(places, this.data.initialSelectionLocation);

    wx.setStorageSync('places', places);
    this.setData({
      places,
      latitude: selectedPlace ? selectedPlace.latitude : this.data.latitude,
      longitude: selectedPlace ? selectedPlace.longitude : this.data.longitude,
      selectedPlace: this.withDisplayState(selectedPlace),
      loadError: loadError || ''
    }, () => {
      this.updateVisibleMarkers();
    });
  },

  withDisplayState(place, userLocation) {
    if (!place) {
      return null;
    }
    const displayPlace = withDisplayMeta(place);
    const currentLocation = userLocation || this.data.userLocation;
    const distanceKm = currentLocation
      ? getDistanceKm(currentLocation, displayPlace)
      : null;

    return {
      ...displayPlace,
      distanceText: getDistanceText(distanceKm)
    };
  },

  prepareMapDotIcons() {
    const iconTasks = CATEGORY_OPTIONS.map((category) => {
      const meta = getPlaceVisualMeta(category);
      return Promise.all([
        drawMapDotIcon(meta),
        drawMapDotIcon(meta, true)
      ]).then(([iconPath, selectedIconPath]) => [category, iconPath, selectedIconPath]);
    });

    return Promise.all(iconTasks).then((entries) => {
      const mapDotIconPaths = entries.reduce((paths, entry) => {
        paths[entry[0]] = entry[1];
        return paths;
      }, {});
      const selectedMapDotIconPaths = entries.reduce((paths, entry) => {
        paths[entry[0]] = entry[2];
        return paths;
      }, {});
      wx.setStorageSync('mapDotIconPaths', mapDotIconPaths);
      this.setData({ mapDotIconPaths, selectedMapDotIconPaths, iconsReady: true }, () => {
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

  createMarkers(displayPlaces) {
    const markerPlaceIds = new Set(this.data.markerPlaceIds);
    const markerPlaces = displayPlaces.filter((place) => markerPlaceIds.has(place.id));
    const markers = placesToMarkers(markerPlaces, {
      selectedPlaceId: this.data.selectedPlace && this.data.selectedPlace.id,
      mapDotIconPaths: this.data.mapDotIconPaths,
      selectedMapDotIconPaths: this.data.selectedMapDotIconPaths,
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

  syncMarkers(displayPlaces) {
    this.setData({
      markers: this.createMarkers(displayPlaces)
    });
  },

  toggleCategory(event) {
    const category = event.currentTarget.dataset.category;
    const activeCategories = getActiveCategoriesForFilter(category);

    this.shouldAutoSelectVisiblePlace = true;
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

    const selectedPlaceId = this.data.selectedPlace && this.data.selectedPlace.id;
    if (marker.placeId === selectedPlaceId) {
      this.ignoreNextMapTap = true;
      return;
    }

    const selectedPlace = this.data.displayPlaces.find((place) => place.id === marker.placeId);
    if (selectedPlace) {
      const selectedPlaceIndex = this.data.displayPlaces.findIndex((place) => place.id === selectedPlace.id);
      this.ignoreNextMapTap = true;
      this.setData({
        selectedPlace: this.withDisplayState(selectedPlace),
        selectedPlaceIndex
      }, () => {
        this.syncMarkers(this.data.displayPlaces);
        this.updateVisibleMarkers();
      });
    }
  },

  onMapTap() {
    if (this.ignoreNextMapTap) {
      this.ignoreNextMapTap = false;
      return;
    }

    if (this.data.selectedPlace) {
      this.setData({ selectedPlace: null }, () => {
        this.updateVisibleMarkers();
      });
    }
  },

  onPlaceCardChange(event) {
    const selectedPlaceIndex = Number(event.detail.current);
    const selectedPlace = this.data.displayPlaces[selectedPlaceIndex];
    if (!selectedPlace || (this.data.selectedPlace && selectedPlace.id === this.data.selectedPlace.id)) {
      return;
    }

    this.setData({
      selectedPlace: this.withDisplayState(selectedPlace),
      selectedPlaceIndex
    }, () => {
      this.syncMarkers(this.data.displayPlaces);
    });
  },

  onRegionChange(event) {
    if (event.type === 'end') {
      this.updateVisibleMarkers();
    }
  },

  updateVisibleMarkers() {
    const map = wx.createMapContext('studyMap');
    const applyVisiblePlaces = (visiblePlaces, region) => {
      const shouldAutoSelect = this.shouldAutoSelectVisiblePlace;
      const unorderedDisplayPlaces = visiblePlaces.map((place) => this.withDisplayState(place));
      const visibleSelectedPlace = this.data.selectedPlace
        ? unorderedDisplayPlaces.find((place) => place.id === this.data.selectedPlace.id)
        : null;
      const coveredSelectedPlace = this.data.selectedPlace
        && !visibleSelectedPlace
        && isPlaceInBounds(this.data.selectedPlace, region)
        ? this.withDisplayState(this.data.selectedPlace)
        : null;
      if (coveredSelectedPlace) {
        unorderedDisplayPlaces.unshift(coveredSelectedPlace);
      }
      const selectedPlace = visibleSelectedPlace
        || coveredSelectedPlace
        || (shouldAutoSelect ? unorderedDisplayPlaces[0] : null);
      const displayPlaces = orderPlacesByProximity(unorderedDisplayPlaces, selectedPlace);
      const selectedPlaceIndex = selectedPlace
        ? displayPlaces.findIndex((place) => place.id === selectedPlace.id)
        : 0;

      this.shouldAutoSelectVisiblePlace = false;
      this.setData({
        ...(region ? { visibleBounds: region } : {}),
        displayPlaces,
        markerPlaceIds: visiblePlaces.map((place) => place.id),
        selectedPlace,
        selectedPlaceIndex,
        noResultsInView: !this.data.loading && this.data.places.length > 0 && visiblePlaces.length === 0,
        emptyStateText: isRegionOutsideShanghai(region)
          ? '目前只有上海的图书馆和食堂数据'
          : '附近没有结果'
      }, () => {
        this.syncMarkers(displayPlaces);
      });
    };
    const applyRegion = (scale) => {
      map.getRegion({
        success: (region) => {
          const cardWillShow = Boolean(this.data.selectedPlace || this.shouldAutoSelectVisiblePlace);
          const occlusion = getMapVerticalOcclusionRatios(this.data.navMetrics, cardWillShow);
          const markerBounds = getBoundsInsideVerticalOverlays(
            region,
            occlusion.top,
            occlusion.bottom
          );
          const visiblePlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            bounds: markerBounds,
            scale
          });
          applyVisiblePlaces(visiblePlaces, region);
        },
        fail: () => {
          const visiblePlaces = getDisplayPlaces(this.data.places, {
            categories: this.data.activeCategories,
            scale
          });
          applyVisiblePlaces(visiblePlaces);
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
    if (this.data.locating) return;
    this.setData({ locating: true });
    wx.showLoading({ title: '定位中' });
    wx.getLocation({
      type: 'gcj02',
      success: (location) => {
        this.recordLocationVisit(location, 'location_button').then((visit) => {
          wx.hideLoading();
          const isShanghai = visit.isShanghai;
          const userLocation = {
            latitude: location.latitude,
            longitude: location.longitude
          };
          const target = isShanghai ? userLocation : SHANGHAI_CENTER_LOCATION;
          this.setData({
            userLocation: isShanghai ? userLocation : null,
            initialSelectionLocation: target,
            latitude: target.latitude,
            longitude: target.longitude,
            selectedPlace: null,
            noResultsInView: false,
            locating: false
          }, () => {
            this.updateVisibleMarkers();
            if (!isShanghai) {
              wx.showToast({
                title: '当前不在上海，已返回上海市中心',
                icon: 'none'
              });
            }
          });
        });
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ locating: false });
        wx.showModal({
          title: '需要定位权限',
          content: '请在设置中允许使用位置，以便回到你当前所在的位置。',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting({
                success: (settings) => {
                  if (settings.authSetting['scope.userLocation']) {
                    this.moveToUserLocation();
                  }
                }
              });
            }
          }
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
