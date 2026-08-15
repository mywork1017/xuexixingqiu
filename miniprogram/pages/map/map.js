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
  USER_LOCATION_DROP_FRAMES,
  USER_LOCATION_JUMP_FRAMES,
  USER_LOCATION_ICON_CANVAS_WIDTH,
  USER_LOCATION_ICON_CANVAS_HEIGHT,
  USER_LOCATION_ICON_ANCHOR_Y,
  drawUserLocationIconFrame,
  drawUserLocationFrameToContext,
  interpolateUserLocationFrame
} = require('../../utils/user-location-icon');
const {
  SHANGHAI_CENTER_LOCATION,
  isRegionOutsideShanghai,
  isWithinShanghaiBounds
} = require('../../utils/location-utils');

const FEATURED_PLACE_NAME = '上海图书馆东馆';
const USER_LOCATION_MARKER_WIDTH = 32;
const USER_LOCATION_MARKER_HEIGHT = 88;
const USER_LOCATION_MARKER_Z_INDEX = 1;
const USER_LOCATION_DROP_START_DELAY_MS = 120;
const USER_LOCATION_DROP_REGION_FALLBACK_MS = 600;
const USER_LOCATION_SEARCH_SPIN_DURATION_MS = 720;
const USER_LOCATION_SEARCH_FADE_MS = 180;
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

function projectLocationToMapPoint(location, region, width, height) {
  const southwest = region && region.southwest;
  const northeast = region && region.northeast;
  if (!location || !southwest || !northeast || !width || !height) {
    return { x: width / 2, y: height / 2 };
  }

  const longitudeSpan = northeast.longitude - southwest.longitude;
  const mercatorY = (latitude) => {
    const boundedLatitude = Math.max(-85, Math.min(85, Number(latitude)));
    const radians = boundedLatitude * Math.PI / 180;
    return Math.log(Math.tan((Math.PI / 4) + (radians / 2)));
  };
  const northY = mercatorY(northeast.latitude);
  const southY = mercatorY(southwest.latitude);
  const latitudeSpan = northY - southY;

  return {
    x: longitudeSpan ? ((location.longitude - southwest.longitude) / longitudeSpan) * width : width / 2,
    y: latitudeSpan ? ((northY - mercatorY(location.latitude)) / latitudeSpan) * height : height / 2
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
    userLocationMarkerAlpha: 1,
    userLocationAnimationVisible: false,
    userLocationAnimationX: 0,
    userLocationAnimationY: 0,
    selectedPlace: null,
    selectedPlaceIndex: 0,
    userLocation: null,
    initialSelectionLocation: SHANGHAI_CENTER_LOCATION,
    iconsReady: false,
    loading: true,
    loadError: '',
    noResultsInView: false,
    emptyStateText: '附近没有结果',
    emptyStateCanGoShanghai: false,
    locating: false,
    cardSwipeDuration: CARD_SWIPE_DURATION_MS,
    visibleBounds: null
  },

  onLoad() {
    Promise.all([
      Promise.all([
        this.prepareMapDotIcons().catch(() => null),
        this.prepareUserLocationIcons().catch(() => null)
      ]),
      this.resolveInitialSelectionLocation()
    ]).then(() => {
      this.syncMarkers([]);
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
    this.stopUserLocationSearchSpin(true);
    this.stopUserLocationDrop(true);
    this.stopUserLocationJump(true);
  },

  onUnload() {
    this.stopSelectedMarkerBreathing();
    this.stopUserLocationSearchSpin();
    this.stopUserLocationDrop();
    this.stopUserLocationJump();
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

  requestAuthorizedLocation(scope, apiName) {
    const callLocationApi = () => new Promise((resolve, reject) => {
      const locationApi = wx[apiName];
      if (typeof locationApi !== 'function') {
        reject(new Error(`${apiName} unavailable`));
        return;
      }
      locationApi({
        type: 'gcj02',
        success: resolve,
        fail: reject
      });
    });

    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (settings) => {
          const authorization = settings.authSetting && settings.authSetting[scope];
          if (authorization === true) {
            callLocationApi().then(resolve, reject);
            return;
          }
          if (authorization === false) {
            reject(new Error(`${scope} denied`));
            return;
          }
          wx.authorize({
            scope,
            success: () => callLocationApi().then(resolve, reject),
            fail: reject
          });
        },
        fail: () => callLocationApi().then(resolve, reject)
      });
    });
  },

  getAuthorizedUserLocation() {
    if (this.pendingLocationRequest) {
      return this.pendingLocationRequest;
    }

    const request = this.requestAuthorizedLocation('scope.userLocation', 'getLocation');
    this.pendingLocationRequest = request;
    return request.then((location) => {
      this.pendingLocationRequest = null;
      return location;
    }, (error) => {
      this.pendingLocationRequest = null;
      throw error;
    });
  },

  resolveInitialSelectionLocation() {
    return this.getAuthorizedUserLocation().then((location) => {
      const userLocation = {
        latitude: location.latitude,
        longitude: location.longitude
      };
      this.keepInitialUserLocationCenter = true;
      this.recordLocationVisit(location, 'page_open');
      return new Promise((resolve) => {
        this.setData({
          userLocation,
          initialSelectionLocation: userLocation,
          latitude: userLocation.latitude,
          longitude: userLocation.longitude
        }, resolve);
      });
    }).catch(() => new Promise((resolve) => {
      this.setData({
        userLocation: null,
        initialSelectionLocation: SHANGHAI_CENTER_LOCATION
      }, resolve);
    }));
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
          this.setData({ loading: false }, () => {
            this.updateVisibleMarkers();
          });
        }
      });
      return;
    }

    this.applyPlaces([], '当前环境无法连接地点后台');
    this.setData({ loading: false }, () => {
      this.updateVisibleMarkers();
    });
  },

  applyPlaces(rawPlaces, loadError) {
    const places = rawPlaces.map(normalizePlace).filter((place) => !isExcludedPlaceType(place));
    const selectedPlace = getNearestPlace(places, this.data.initialSelectionLocation);
    const keepUserLocationCenter = Boolean(this.keepInitialUserLocationCenter && this.data.userLocation);
    this.keepInitialUserLocationCenter = false;

    wx.setStorageSync('places', places);
    this.setData({
      places,
      latitude: keepUserLocationCenter ? this.data.userLocation.latitude : (selectedPlace ? selectedPlace.latitude : this.data.latitude),
      longitude: keepUserLocationCenter ? this.data.userLocation.longitude : (selectedPlace ? selectedPlace.longitude : this.data.longitude),
      selectedPlace: keepUserLocationCenter ? null : this.withDisplayState(selectedPlace),
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

  prepareUserLocationIcons() {
    const settledFrame = USER_LOCATION_DROP_FRAMES[USER_LOCATION_DROP_FRAMES.length - 1];
    return drawUserLocationIconFrame(settledFrame).then((settledIconPath) => {
      this.setData({
        userLocationIconPath: settledIconPath
      });
      return settledIconPath;
    });
  },

  setUserLocationMarkerAlpha(alpha, additionalUpdates = {}, callback) {
    const markerIndex = this.data.markers.findIndex((marker) => marker.markerType === 'user-location');
    const updates = { userLocationMarkerAlpha: alpha, ...additionalUpdates };
    if (markerIndex >= 0) {
      updates[`markers[${markerIndex}].alpha`] = alpha;
    }
    this.setData(updates, callback);
  },

  ensureUserLocationAnimationCanvas(callback) {
    if (this.userLocationAnimationCanvas && this.userLocationAnimationContext) {
      callback(this.userLocationAnimationCanvas, this.userLocationAnimationContext);
      return;
    }

    wx.createSelectorQuery()
      .in(this)
      .select('#userLocationAnimationCanvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvas = result && result[0] && result[0].node;
        if (!canvas) return;
        const windowInfo = typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
        const pixelRatio = Number(windowInfo.pixelRatio || 1);
        canvas.width = USER_LOCATION_ICON_CANVAS_WIDTH * pixelRatio;
        canvas.height = USER_LOCATION_ICON_CANVAS_HEIGHT * pixelRatio;
        const context = canvas.getContext('2d');
        context.scale(pixelRatio, pixelRatio);
        this.userLocationAnimationCanvas = canvas;
        this.userLocationAnimationContext = context;
        callback(canvas, context);
      });
  },

  getUserLocationAnimationPosition(callback) {
    const windowInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const width = Number(windowInfo.windowWidth || 375);
    const height = Number(windowInfo.windowHeight || 667);
    const fallback = { x: width / 2, y: height / 2 };
    const map = wx.createMapContext('studyMap');

    map.getRegion({
      success: (region) => callback(projectLocationToMapPoint(this.data.userLocation, region, width, height)),
      fail: () => callback(fallback)
    });
  },

  cancelUserLocationAnimationFrame() {
    if (!this.userLocationAnimationFrame) return;
    if (this.userLocationAnimationFrameMode === 'canvas' && this.userLocationAnimationCanvas) {
      this.userLocationAnimationCanvas.cancelAnimationFrame(this.userLocationAnimationFrame);
    } else {
      clearTimeout(this.userLocationAnimationFrame);
    }
    this.userLocationAnimationFrame = null;
  },

  requestUserLocationAnimationFrame(callback) {
    if (this.userLocationAnimationCanvas && typeof this.userLocationAnimationCanvas.requestAnimationFrame === 'function') {
      this.userLocationAnimationFrameMode = 'canvas';
      this.userLocationAnimationFrame = this.userLocationAnimationCanvas.requestAnimationFrame(callback);
      return;
    }
    this.userLocationAnimationFrameMode = 'timer';
    this.userLocationAnimationFrame = setTimeout(callback, 16);
  },

  requestUserLocationSearchFinish() {
    this.userLocationSearchStopRequested = true;
    const elapsed = Math.max(0, Date.now() - Number(this.userLocationSearchStartedAt || Date.now()));
    this.userLocationSearchFinishAt = Math.ceil((elapsed + 1) / USER_LOCATION_SEARCH_SPIN_DURATION_MS)
      * USER_LOCATION_SEARCH_SPIN_DURATION_MS;
  },

  tryStartUserLocationDrop() {
    if (!this.pendingUserLocationDrop
      || !this.userLocationDropPositionReady
      || !this.userLocationSearchSpinComplete) {
      return;
    }
    this.pendingUserLocationDrop = false;
    this.userLocationDropPositionReady = false;
    if (this.userLocationDropStartTimer) {
      clearTimeout(this.userLocationDropStartTimer);
      this.userLocationDropStartTimer = null;
    }
    this.startUserLocationDrop(true);
  },

  stopUserLocationSearchSpin(settle = false) {
    this.userLocationSearchStopRequested = false;
    this.userLocationSearchSpinComplete = false;
    this.userLocationSearchFinishAt = null;
    if (this.userLocationAnimationType === 'search' || settle) {
      this.stopUserLocationCanvasAnimation(settle);
    }
  },

  startUserLocationSearchSpin() {
    this.stopUserLocationDrop();
    this.stopUserLocationJump();
    this.stopUserLocationCanvasAnimation();
    const runId = (this.userLocationAnimationRunId || 0) + 1;
    this.userLocationAnimationRunId = runId;
    this.userLocationAnimationType = 'search';
    this.userLocationSearchStopRequested = false;
    this.userLocationSearchSpinComplete = false;
    this.userLocationSearchFinishAt = null;

    const windowInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const point = {
      x: Number(windowInfo.windowWidth || 375) / 2,
      y: Number(windowInfo.windowHeight || 667) / 2
    };
    const baseFrame = { ...USER_LOCATION_DROP_FRAMES[0], alpha: 1 };

    this.ensureUserLocationAnimationCanvas((canvas, context) => {
      if (runId !== this.userLocationAnimationRunId) return;
      const canvasX = point.x - (USER_LOCATION_MARKER_WIDTH / 2);
      const canvasY = point.y - (USER_LOCATION_MARKER_HEIGHT * USER_LOCATION_ICON_ANCHOR_Y);
      drawUserLocationFrameToContext(context, { ...baseFrame, alpha: 0, spinYRotation: 0 });
      this.setUserLocationMarkerAlpha(0, {
        userLocationAnimationVisible: true,
        userLocationAnimationX: canvasX,
        userLocationAnimationY: canvasY
      }, () => {
        if (runId !== this.userLocationAnimationRunId) return;
        this.userLocationSearchStartedAt = Date.now();
        const render = () => {
          if (runId !== this.userLocationAnimationRunId) return;
          const elapsed = Date.now() - this.userLocationSearchStartedAt;
          const cycleProgress = (elapsed % USER_LOCATION_SEARCH_SPIN_DURATION_MS)
            / USER_LOCATION_SEARCH_SPIN_DURATION_MS;
          const alpha = Math.min(1, elapsed / USER_LOCATION_SEARCH_FADE_MS);
          const shouldFinish = this.userLocationSearchStopRequested
            && elapsed >= Number(this.userLocationSearchFinishAt || Infinity);
          const spatialSpinBlend = this.userLocationSearchStopRequested
            ? Math.max(0, Math.min(1, (this.userLocationSearchFinishAt - elapsed) / 60))
            : 1;
          drawUserLocationFrameToContext(context, {
            ...baseFrame,
            alpha,
            spinYRotation: shouldFinish ? 0 : cycleProgress * 360,
            spatialSpinBlend: shouldFinish ? 0 : spatialSpinBlend
          });
          if (shouldFinish) {
            this.userLocationAnimationFrame = null;
            this.userLocationSearchSpinComplete = true;
            this.tryStartUserLocationDrop();
            return;
          }
          this.requestUserLocationAnimationFrame(render);
        };
        render();
      });
    });
  },

  finishUserLocationAnimation(runId) {
    if (runId !== this.userLocationAnimationRunId) return;
    this.cancelUserLocationAnimationFrame();
    this.userLocationAnimationType = null;
    this.setUserLocationMarkerAlpha(1, { userLocationAnimationVisible: false }, () => {
      if (this.userLocationAnimationContext) {
        this.userLocationAnimationContext.clearRect(
          0,
          0,
          USER_LOCATION_ICON_CANVAS_WIDTH,
          USER_LOCATION_ICON_CANVAS_HEIGHT
        );
      }
    });
  },

  stopUserLocationCanvasAnimation(settle = false) {
    const wasActive = Boolean(this.userLocationAnimationType || this.data.userLocationAnimationVisible);
    this.userLocationAnimationRunId = (this.userLocationAnimationRunId || 0) + 1;
    this.cancelUserLocationAnimationFrame();
    this.userLocationAnimationType = null;
    if (wasActive || settle) {
      this.setUserLocationMarkerAlpha(1, { userLocationAnimationVisible: false });
    }
  },

  startUserLocationCanvasAnimation(frames, animationType, options = {}) {
    if (!this.data.userLocation || !frames.length) return;
    if (options.reuseVisibleCanvas) {
      this.userLocationAnimationRunId = (this.userLocationAnimationRunId || 0) + 1;
      this.cancelUserLocationAnimationFrame();
    } else {
      this.stopUserLocationCanvasAnimation();
    }
    const runId = (this.userLocationAnimationRunId || 0) + 1;
    this.userLocationAnimationRunId = runId;
    this.userLocationAnimationType = animationType;
    const totalDuration = frames.reduce((sum, frame) => sum + Number(frame.duration || 0), 0);

    this.getUserLocationAnimationPosition((point) => {
      if (runId !== this.userLocationAnimationRunId) return;
      this.ensureUserLocationAnimationCanvas((canvas, context) => {
        if (runId !== this.userLocationAnimationRunId) return;
        const canvasX = point.x - (USER_LOCATION_MARKER_WIDTH / 2);
        const canvasY = point.y - (USER_LOCATION_MARKER_HEIGHT * USER_LOCATION_ICON_ANCHOR_Y);
        drawUserLocationFrameToContext(context, interpolateUserLocationFrame(frames, 0));
        this.setUserLocationMarkerAlpha(0, {
          userLocationAnimationVisible: true,
          userLocationAnimationX: canvasX,
          userLocationAnimationY: canvasY
        }, () => {
          if (runId !== this.userLocationAnimationRunId) return;
          const startedAt = Date.now();
          const render = () => {
            if (runId !== this.userLocationAnimationRunId) return;
            const elapsed = Date.now() - startedAt;
            const frame = interpolateUserLocationFrame(frames, elapsed);
            drawUserLocationFrameToContext(context, frame);
            if (elapsed >= totalDuration) {
              this.finishUserLocationAnimation(runId);
              return;
            }
            this.requestUserLocationAnimationFrame(render);
          };
          render();
        });
      });
    });
  },

  stopUserLocationDrop(settle = false) {
    if (this.userLocationDropStartTimer) {
      clearTimeout(this.userLocationDropStartTimer);
      this.userLocationDropStartTimer = null;
    }
    this.pendingUserLocationDrop = false;
    if (this.userLocationAnimationType === 'drop' || settle) {
      this.stopUserLocationCanvasAnimation(settle);
    }
  },

  startUserLocationDrop(fromSearch = false) {
    this.stopUserLocationJump();
    this.stopUserLocationDrop();
    const frames = fromSearch
      ? USER_LOCATION_DROP_FRAMES.map((frame) => ({ ...frame, alpha: 1 }))
      : USER_LOCATION_DROP_FRAMES;
    this.startUserLocationCanvasAnimation(frames, 'drop', { reuseVisibleCanvas: fromSearch });
  },

  queueUserLocationDrop() {
    this.stopUserLocationJump();
    this.stopUserLocationDrop();
    this.pendingUserLocationDrop = true;
    this.userLocationDropPositionReady = false;
    this.requestUserLocationSearchFinish();
    this.userLocationDropStartTimer = setTimeout(() => {
      this.userLocationDropStartTimer = null;
      if (!this.pendingUserLocationDrop) return;
      this.userLocationDropPositionReady = true;
      this.tryStartUserLocationDrop();
    }, USER_LOCATION_DROP_REGION_FALLBACK_MS);
  },

  stopUserLocationJump(settle = false) {
    if (this.userLocationAnimationType === 'jump' || settle) {
      this.stopUserLocationCanvasAnimation(settle);
    }
  },

  startUserLocationJump() {
    this.stopUserLocationDrop();
    this.stopUserLocationJump();
    this.startUserLocationCanvasAnimation(USER_LOCATION_JUMP_FRAMES, 'jump');
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
        width: USER_LOCATION_MARKER_WIDTH,
        height: USER_LOCATION_MARKER_HEIGHT,
        anchor: { x: 0.5, y: USER_LOCATION_ICON_ANCHOR_Y },
        alpha: this.data.userLocationMarkerAlpha,
        zIndex: USER_LOCATION_MARKER_Z_INDEX
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

    if (marker.markerType === 'user-location') {
      this.ignoreNextMapTap = true;
      this.startUserLocationJump();
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
      if (this.pendingUserLocationDrop) {
        if (this.userLocationDropStartTimer) {
          clearTimeout(this.userLocationDropStartTimer);
        }
        this.userLocationDropStartTimer = setTimeout(() => {
          this.userLocationDropStartTimer = null;
          if (!this.pendingUserLocationDrop) return;
          this.userLocationDropPositionReady = true;
          this.tryStartUserLocationDrop();
        }, USER_LOCATION_DROP_START_DELAY_MS);
      }
    }
  },

  updateVisibleMarkers() {
    const map = wx.createMapContext('studyMap');
    const applyVisiblePlaces = (visiblePlaces, region) => {
      const shouldAutoSelect = this.shouldAutoSelectVisiblePlace;
      const outsideShanghai = isRegionOutsideShanghai(region);
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
        emptyStateText: outsideShanghai
          ? '目前只有上海的图书馆和食堂数据'
          : '附近没有结果',
        emptyStateCanGoShanghai: outsideShanghai
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
    if (this.data.locating || this.pendingUserLocationDrop || this.userLocationAnimationType === 'search') return;
    this.setData({ locating: true }, () => {
      this.startUserLocationSearchSpin();
    });
    this.getAuthorizedUserLocation().then((location) => {
      this.recordLocationVisit(location, 'location_button').then(() => {
        const userLocation = {
          latitude: location.latitude,
          longitude: location.longitude
        };
        this.setData({
          userLocation,
          initialSelectionLocation: userLocation,
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          selectedPlace: null,
          noResultsInView: false,
          locating: false
        }, () => {
          this.updateVisibleMarkers();
          this.queueUserLocationDrop();
        });
      });
    }).catch(() => {
      this.setData({ locating: false }, () => {
        this.stopUserLocationSearchSpin(true);
      });
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
    });
  },

  goToShanghaiCenter() {
    this.setData({
      latitude: SHANGHAI_CENTER_LOCATION.latitude,
      longitude: SHANGHAI_CENTER_LOCATION.longitude,
      selectedPlace: null,
      noResultsInView: false,
      emptyStateCanGoShanghai: false
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
