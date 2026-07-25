const CATEGORY_OPTIONS = [
  '图书馆',
  '书店',
  '自习室',
  '党群服务中心',
  '社区食堂'
];

const CATEGORY_FILTER_OPTIONS = ['全部', ...CATEGORY_OPTIONS];

const CATEGORY_ASSET_KEYS = {
  图书馆: 'tsg',
  书店: 'sd',
  自习室: 'zxs',
  党群服务中心: 'dq',
  社区食堂: 'st'
};

const CATEGORY_META = {
  图书馆: { color: '#7f9661', shortName: '图', assetKey: CATEGORY_ASSET_KEYS['图书馆'] },
  书店: { color: '#b8894d', shortName: '书', assetKey: CATEGORY_ASSET_KEYS['书店'] },
  自习室: { color: '#7471b8', shortName: '习', assetKey: CATEGORY_ASSET_KEYS['自习室'] },
  党群服务中心: { color: '#b74b42', shortName: '党', assetKey: CATEGORY_ASSET_KEYS['党群服务中心'] },
  社区食堂: { color: '#a8b85a', shortName: '食', assetKey: CATEGORY_ASSET_KEYS['社区食堂'] }
};

const LOW_SCALE_THRESHOLD = 11;
const EARTH_RADIUS_KM = 6371;
const DEFAULT_DETAIL_COVER = '/assets/backdrops/detail-cover.png';

function createPlaceImportId(place) {
  const source = `${place.category || ''}|${place.name || ''}|${place.address || ''}`;
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `place_${(hash >>> 0).toString(36)}`;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.filter(Boolean);
  }
  if (!tags) {
    return [];
  }
  return String(tags)
    .split(/[;；,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getPlaceVisualMeta(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META['图书馆'];
  const assetKey = meta.assetKey || CATEGORY_ASSET_KEYS['图书馆'];
  const selectedMarkerIconPath = `/assets/markers/map/ditu_xiangqing_ditu_${assetKey}_xuanzhong.png`;
  const categoryIconPath = `/assets/place-avatars/category/ditu_xiangqing_wode_fenlei_${assetKey}.png`;
  return {
    ...meta,
    mapMarkerColor: meta.color,
    mapSelectedMarkerIconPath: selectedMarkerIconPath,
    detailMapSelectedMarkerIconPath: selectedMarkerIconPath,
    mapCardAvatarPath: categoryIconPath,
    detailMainAvatarPath: categoryIconPath,
    nearbyAvatarPath: categoryIconPath,
    favoriteAvatarPath: categoryIconPath
  };
}

function getPlaceDisplayPhotos(place) {
  const normalizedPhotos = Array.isArray(place && place.photos)
    ? place.photos.filter(Boolean)
    : normalizeTags(place && place.imageUrls);

  return normalizedPhotos.length ? normalizedPhotos : [DEFAULT_DETAIL_COVER];
}

function normalizePlace(rawPlace) {
  const latitude = Number(rawPlace.latitude);
  const longitude = Number(rawPlace.longitude);
  const photos = Array.isArray(rawPlace.photos)
    ? rawPlace.photos.filter(Boolean)
    : normalizeTags(rawPlace.imageUrls);

  return {
    ...rawPlace,
    id: rawPlace.id || rawPlace._id || rawPlace.placeId || rawPlace.name,
    latitude,
    longitude,
    tags: normalizeTags(rawPlace.tags),
    phone: rawPlace.phone || '',
    hours: rawPlace.hours || '',
    address: rawPlace.address || '',
    description: rawPlace.description || '',
    priority: rawPlace.priority || '',
    photos,
    source: rawPlace.source || 'manual',
    updatedAt: rawPlace.updatedAt || ''
  };
}

function filterPlaces(places, category) {
  if (!category || category === '全部') {
    return places;
  }
  return places.filter((place) => place.category === category);
}

function filterPlacesByCategories(places, categories) {
  if (!Array.isArray(categories)) {
    return places;
  }

  if (!categories.length) {
    return [];
  }

  const selectedCategories = new Set(categories);
  return places.filter((place) => selectedCategories.has(place.category));
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

function sortPlacesByFavoriteRecords(places, favoriteRecords) {
  const createdAtByPlaceId = new Map((Array.isArray(favoriteRecords) ? favoriteRecords : [])
    .map((record, index) => [
      record.placeId,
      {
        index,
        time: record.createdAt ? new Date(record.createdAt).getTime() : 0
      }
    ]));

  return places.slice().sort((first, second) => {
    const firstMeta = createdAtByPlaceId.get(first.id) || { index: Number.MAX_SAFE_INTEGER, time: 0 };
    const secondMeta = createdAtByPlaceId.get(second.id) || { index: Number.MAX_SAFE_INTEGER, time: 0 };

    if (firstMeta.time !== secondMeta.time) {
      return secondMeta.time - firstMeta.time;
    }

    return firstMeta.index - secondMeta.index;
  });
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

function placesToMarkers(places, options = {}) {
  let markerId = 1;
  const markers = [];
  const selectedMarkers = [];
  const markerUsage = options.markerUsage || 'map';
  const mapDotIconPaths = options.mapDotIconPaths || {};
  const selectedLabelIcon = options.selectedLabelIcon || null;
  const originalLayerByPlaceId = new Map((options.allPlaceIds || [])
    .map((placeId, index) => [placeId, index]));

  places
    .map(normalizePlace)
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .forEach((place, index) => {
      const meta = getPlaceVisualMeta(place.category);
      const selected = place.id === options.selectedPlaceId;
      const dotIconPath = mapDotIconPaths[place.category];
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
          title: place.name,
          iconPath: dotIconPath,
          width: selected ? 20 : 18,
          height: selected ? 20 : 18,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: selected ? 10000 : 10 + originalLayer
        };
        (selected ? selectedMarkers : markers).push(dotMarker);
        markerId += 1;
      }

      if (selected) {
        const selectedIconPath = markerUsage === 'detail-map'
          ? meta.detailMapSelectedMarkerIconPath
          : meta.mapSelectedMarkerIconPath;
        const labelIconPath = selectedLabelIcon && selectedLabelIcon.placeId === place.id
          ? selectedLabelIcon.path
          : '';

        selectedMarkers.push({
          id: markerId,
          placeId: place.id,
          markerType: 'selected',
          latitude: place.latitude,
          longitude: place.longitude,
          title: place.name,
          iconPath: selectedIconPath,
          width: 27,
          height: 34,
          anchor: { x: 0.5, y: 1 },
          zIndex: 10001
        });
        markerId += 1;

        if (labelIconPath) {
          selectedMarkers.push({
            id: markerId,
            placeId: place.id,
            markerType: 'selected-label',
            latitude: place.latitude,
            longitude: place.longitude,
            title: place.name,
            iconPath: labelIconPath,
            width: selectedLabelIcon.width,
            height: selectedLabelIcon.height,
            anchor: { x: 0.5, y: 0 },
            zIndex: 10002
          });
          markerId += 1;
        }
      }
    });

  return markers.concat(selectedMarkers);
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parsePlacesCsv(csvText) {
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = headers.reduce((place, header, index) => {
      place[header] = values[index] || '';
      return place;
    }, {});
    return normalizePlace(row);
  });
}

function placesToImportDocuments(places) {
  return places.map((place) => {
    const normalizedPlace = normalizePlace(place);
    return {
      _id: createPlaceImportId(normalizedPlace),
      name: normalizedPlace.name,
      category: normalizedPlace.category,
      latitude: normalizedPlace.latitude,
      longitude: normalizedPlace.longitude,
      address: normalizedPlace.address,
      hours: normalizedPlace.hours,
      phone: normalizedPlace.phone,
      tags: normalizedPlace.tags,
      description: normalizedPlace.description,
      priority: normalizedPlace.priority,
      photos: normalizedPlace.photos,
      source: normalizedPlace.source,
      updatedAt: normalizedPlace.updatedAt
    };
  });
}

module.exports = {
  CATEGORY_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_META,
  LOW_SCALE_THRESHOLD,
  createPlaceImportId,
  filterPlaces,
  filterPlacesByCategories,
  getActiveCategoriesForFilter,
  getDefaultSelectedPlace,
  getDisplayPlaces,
  getDistanceText,
  getPlaceDisplayPhotos,
  getPlaceVisualMeta,
  getDistanceKm,
  getNearbyPlaces,
  normalizePlace,
  parsePlacesCsv,
  placesToImportDocuments,
  placesToMarkers,
  sortPlacesByFavoriteRecords
};
