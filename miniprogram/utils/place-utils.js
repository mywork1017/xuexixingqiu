const CATEGORY_OPTIONS = [
  '图书馆',
  '食堂'
];

const CATEGORY_FILTER_OPTIONS = ['全部', ...CATEGORY_OPTIONS];

const CATEGORY_ASSET_KEYS = {
  图书馆: 'tsg',
  食堂: 'st'
};

const CATEGORY_META = {
  图书馆: {
    color: '#000000',
    markerStyle: 'solid',
    shortName: '图',
    assetKey: CATEGORY_ASSET_KEYS['图书馆']
  },
  食堂: {
    color: '#000000',
    markerStyle: 'inverse',
    shortName: '食',
    assetKey: CATEGORY_ASSET_KEYS['食堂']
  }
};

const LOW_SCALE_THRESHOLD = 11;
const EARTH_RADIUS_KM = 6371;
const SELECTED_MARKER_Z_INDEX = 999;

function normalizeDelimitedValues(values) {
  if (Array.isArray(values)) {
    return values.filter(Boolean);
  }
  if (!values) {
    return [];
  }
  return String(values)
    .split(/[;；,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getPlaceVisualMeta(category) {
  const meta = CATEGORY_META[normalizeCategory(category)] || CATEGORY_META['图书馆'];
  const assetKey = meta.assetKey || CATEGORY_ASSET_KEYS['图书馆'];
  return {
    ...meta,
    mapMarkerColor: meta.color
  };
}

function normalizeCategory(category) {
  return category;
}

function normalizeCategoryIconPaths(iconPaths) {
  return Object.entries(iconPaths || {}).reduce((paths, [category, iconPath]) => {
    if (iconPath) {
      paths[normalizeCategory(category)] = iconPath;
    }
    return paths;
  }, {});
}

function normalizePlaceCategory(place) {
  const category = normalizeCategory(place.category);
  return category === place.category ? place : { ...place, category };
}

function getPlaceDisplayPhotos(place) {
  const normalizedPhotos = Array.isArray(place && place.photos)
    ? place.photos.filter(Boolean)
    : normalizeDelimitedValues(place && place.imageUrls);

  return normalizedPhotos;
}

function getPlaceDisplayAddress(place) {
  return String((place && place.address) || '').trim() || '地址待补充';
}

function getPlaceDisplayHours(place) {
  const hours = String((place && place.hours) || '').trim();
  return hours && !/现场公示/.test(hours) ? hours : '—';
}

function getPlaceNavigationLabel(place) {
  return normalizeCategory(place && place.category) === '食堂' ? '去吃饭' : '去学习';
}

function sanitizePlaceDescription(value) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  return source.replace(/[。！？；;，,.!?]+$/g, '');
}

function isExcludedPlaceType(place) {
  const name = String((place && place.name) || place || '');
  if (name === '阅闲坊') return true;
  if (/(书房|图书室|阅读空间|借阅点|流动图书)/.test(name) && !/图书馆/.test(name)) {
    return true;
  }
  return /(党群|党建)/.test(name) && !/图书馆/.test(name);
}

function normalizePlace(rawPlace) {
  const latitude = Number(rawPlace.latitude);
  const longitude = Number(rawPlace.longitude);
  const photos = Array.isArray(rawPlace.photos)
    ? rawPlace.photos.filter(Boolean)
    : normalizeDelimitedValues(rawPlace.imageUrls);

  return {
    ...rawPlace,
    id: rawPlace.id || rawPlace._id || rawPlace.placeId || rawPlace.name,
    category: normalizeCategory(rawPlace.category),
    latitude,
    longitude,
    hours: rawPlace.hours || '',
    address: rawPlace.address || '',
    description: sanitizePlaceDescription(rawPlace.description || rawPlace.facilities || ''),
    priority: rawPlace.priority || '',
    photos,
    updatedAt: rawPlace.updatedAt || ''
  };
}

function filterPlaces(places, category) {
  const normalizedPlaces = places.map(normalizePlaceCategory).filter((place) => !isExcludedPlaceType(place));
  if (!category || category === '全部') {
    return normalizedPlaces.filter((place) => CATEGORY_OPTIONS.includes(place.category));
  }
  const normalizedCategory = normalizeCategory(category);
  if (!CATEGORY_OPTIONS.includes(normalizedCategory)) {
    return [];
  }
  return normalizedPlaces.filter((place) => place.category === normalizedCategory);
}

function filterPlacesByCategories(places, categories) {
  if (!Array.isArray(categories)) {
    return places;
  }

  if (!categories.length) {
    return [];
  }

  const selectedCategories = new Set(
    categories.filter((category) => CATEGORY_OPTIONS.includes(category))
  );
  return places
    .map(normalizePlaceCategory)
    .filter((place) => selectedCategories.has(place.category) && !isExcludedPlaceType(place));
}

function getActiveCategoriesForFilter(filterName) {
  if (!filterName || filterName === '全部' || CATEGORY_OPTIONS.indexOf(filterName) < 0) {
    return CATEGORY_OPTIONS.slice();
  }

  return [filterName];
}

function isPlaceInBounds(place, bounds) {
  if (!bounds || !bounds.southwest || !bounds.northeast) {
    return true;
  }

  const normalizedPlace = normalizePlace(place);
  return normalizedPlace.latitude >= bounds.southwest.latitude
    && normalizedPlace.latitude <= bounds.northeast.latitude
    && normalizedPlace.longitude >= bounds.southwest.longitude
    && normalizedPlace.longitude <= bounds.northeast.longitude;
}

function getBoundsInsideVerticalOverlays(bounds, topOccludedRatio, bottomOccludedRatio) {
  if (!bounds || !bounds.southwest || !bounds.northeast) {
    return bounds;
  }
  const topRatio = Math.max(0, Math.min(Number(topOccludedRatio) || 0, 0.45));
  const bottomRatio = Math.max(0, Math.min(Number(bottomOccludedRatio) || 0, 0.45));
  const latitudeSpan = bounds.northeast.latitude - bounds.southwest.latitude;
  return {
    southwest: {
      ...bounds.southwest,
      latitude: bounds.southwest.latitude + (latitudeSpan * bottomRatio)
    },
    northeast: {
      ...bounds.northeast,
      latitude: bounds.northeast.latitude - (latitudeSpan * topRatio)
    }
  };
}

function shouldShowPlaceAtScale(place, scale) {
  if (!scale || scale >= LOW_SCALE_THRESHOLD) {
    return true;
  }

  return place.priority === 'major' || place.category === '图书馆';
}

function getDisplayPlaces(places, options = {}) {
  const normalizedPlaces = places.map(normalizePlace);
  const categoryFilteredPlaces = filterPlacesByCategories(normalizedPlaces, options.categories);

  return categoryFilteredPlaces
    .filter((place) => isPlaceInBounds(place, options.bounds))
    .filter((place) => shouldShowPlaceAtScale(place, Number(options.scale)));
}

function getDefaultSelectedPlace(places, options = {}) {
  const displayPlaces = getDisplayPlaces(places, options);
  const origin = options.origin ? normalizePlace(options.origin) : null;
  const fallbackPlaces = displayPlaces.length
    ? displayPlaces
    : filterPlacesByCategories(places.map(normalizePlace), options.categories);

  if (!fallbackPlaces.length) {
    return null;
  }

  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
    return fallbackPlaces[0];
  }

  return fallbackPlaces
    .map((place) => ({
      place,
      distanceKm: getDistanceKm(origin, place)
    }))
    .sort((first, second) => first.distanceKm - second.distanceKm)[0].place;
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function getDistanceKm(fromPlace, toPlace) {
  const from = normalizePlace(fromPlace);
  const to = normalizePlace(toPlace);
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2)
    + Math.cos(fromLatitude) * Math.cos(toLatitude)
    * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

function getDistanceText(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') {
    return '';
  }

  const distance = Number(distanceKm);

  if (!Number.isFinite(distance) || distance < 0) {
    return '';
  }

  if (distance < 1) {
    return `${Math.round(distance * 1000)} 米`;
  }

  return `${distance.toFixed(1)} 公里`;
}

function getNearbyPlaces(targetPlace, places, options = {}) {
  const radiusKm = Number(options.radiusKm || 2);
  const categories = options.categories || [];
  const target = normalizePlace(targetPlace);

  return filterPlacesByCategories(places.map(normalizePlace), categories)
    .filter((place) => place.id !== target.id)
    .map((place) => ({
      ...place,
      distanceKm: getDistanceKm(target, place)
    }))
    .filter((place) => place.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function orderPlacesByProximity(places, anchorPlace) {
  const normalizedPlaces = places.map(normalizePlace);
  if (normalizedPlaces.length < 2) {
    return normalizedPlaces;
  }

  const anchorId = anchorPlace && anchorPlace.id;
  const anchorIndex = Math.max(0, normalizedPlaces.findIndex((place) => place.id === anchorId));
  const anchor = normalizedPlaces[anchorIndex];
  const route = [anchor];
  const remaining = normalizedPlaces.filter((_, index) => index !== anchorIndex);

  const takeNearest = (target) => {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((place, index) => {
      const distance = getDistanceKm(target, place);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    return remaining.splice(nearestIndex, 1)[0];
  };

  route.push(takeNearest(anchor));
  if (remaining.length) {
    route.unshift(takeNearest(anchor));
  }

  while (remaining.length) {
    let candidateIndex = 0;
    let insertionSide = 'right';
    let nearestEndpointDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((place, index) => {
      const leftDistance = getDistanceKm(route[0], place);
      const rightDistance = getDistanceKm(route[route.length - 1], place);
      const distance = Math.min(leftDistance, rightDistance);
      if (distance < nearestEndpointDistance) {
        nearestEndpointDistance = distance;
        candidateIndex = index;
        insertionSide = leftDistance < rightDistance ? 'left' : 'right';
      }
    });
    const [candidate] = remaining.splice(candidateIndex, 1);
    if (insertionSide === 'left') {
      route.unshift(candidate);
    } else {
      route.push(candidate);
    }
  }

  const rotatedAnchorIndex = route.findIndex((place) => place.id === anchor.id);
  return route.slice(rotatedAnchorIndex).concat(route.slice(0, rotatedAnchorIndex));
}

function placesToMarkers(places, options = {}) {
  let markerId = 1;
  const markers = [];
  const selectedMarkers = [];
  const mapDotIconPaths = normalizeCategoryIconPaths(options.mapDotIconPaths);
  const selectedMapDotIconPath = options.selectedMapDotIconPath || '';
  const selectedMapDotIconPaths = normalizeCategoryIconPaths(options.selectedMapDotIconPaths);
  const originalLayerByPlaceId = new Map((options.allPlaceIds || [])
    .map((placeId, index) => [placeId, index]));

  places
    .map(normalizePlace)
    .filter((place) => !isExcludedPlaceType(place))
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .forEach((place, index) => {
      const selected = place.id === options.selectedPlaceId;
      const selectedIconPath = selectedMapDotIconPaths[place.category] || selectedMapDotIconPath;
      const dotIconPath = selected && selectedIconPath
        ? selectedIconPath
        : mapDotIconPaths[place.category];
      const originalLayer = originalLayerByPlaceId.has(place.id)
        ? originalLayerByPlaceId.get(place.id)
        : index;

      if (dotIconPath) {
        const dotMarker = {
          id: markerId,
          placeId: place.id,
          markerType: 'dot',
          latitude: place.latitude,
          longitude: place.longitude,
          iconPath: dotIconPath,
          width: selected ? 39 : 22,
          height: selected ? 39 : 22,
          alpha: 1,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: selected ? SELECTED_MARKER_Z_INDEX : 10 + originalLayer
        };
        (selected ? selectedMarkers : markers).push(dotMarker);
        markerId += 1;
      }

    });

  return markers.concat(selectedMarkers);
}

module.exports = {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  LOW_SCALE_THRESHOLD,
  filterPlaces,
  filterPlacesByCategories,
  getActiveCategoriesForFilter,
  getDefaultSelectedPlace,
  getDisplayPlaces,
  getDistanceText,
  getBoundsInsideVerticalOverlays,
  getPlaceDisplayAddress,
  getPlaceDisplayHours,
  getPlaceNavigationLabel,
  getPlaceDisplayPhotos,
  getPlaceVisualMeta,
  getDistanceKm,
  getNearbyPlaces,
  orderPlacesByProximity,
  isExcludedPlaceType,
  isPlaceInBounds,
  normalizeCategory,
  normalizeCategoryIconPaths,
  normalizePlace,
  placesToMarkers,
  sanitizePlaceDescription
};
