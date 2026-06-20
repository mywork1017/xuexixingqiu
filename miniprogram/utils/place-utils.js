const CATEGORY_OPTIONS = [
  '图书馆',
  '书店',
  '自习室',
  '党群服务中心',
  '社区食堂'
];

const CATEGORY_FILTER_OPTIONS = ['全部', ...CATEGORY_OPTIONS];

const CATEGORY_META = {
  图书馆: { color: '#7f9661', shortName: '图', iconPath: '/assets/markers/library-dot.png', selectedIconPath: '/assets/markers/library-selected.png' },
  书店: { color: '#b8894d', shortName: '书', iconPath: '/assets/markers/bookstore-dot.png', selectedIconPath: '/assets/markers/bookstore-selected.png' },
  自习室: { color: '#7471b8', shortName: '习', iconPath: '/assets/markers/study-dot.png', selectedIconPath: '/assets/markers/study-selected.png' },
  党群服务中心: { color: '#b74b42', shortName: '党', iconPath: '/assets/markers/service-dot.png', selectedIconPath: '/assets/markers/service-selected.png' },
  社区食堂: { color: '#a8b85a', shortName: '食', iconPath: '/assets/markers/canteen-dot.png', selectedIconPath: '/assets/markers/canteen-selected.png' }
};

const LOW_SCALE_THRESHOLD = 11;
const EARTH_RADIUS_KM = 6371;

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
  return places
    .map(normalizePlace)
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .map((place, index) => {
      const meta = CATEGORY_META[place.category] || CATEGORY_META['图书馆'];
      const selected = place.id === options.selectedPlaceId;
      return {
        id: index + 1,
        placeId: place.id,
        latitude: place.latitude,
        longitude: place.longitude,
        title: place.name,
        iconPath: selected ? meta.selectedIconPath : meta.iconPath,
        width: selected ? 32 : 18,
        height: selected ? 32 : 18,
        anchor: { x: 0.5, y: 0.5 },
        zIndex: selected ? 10 : 1
      };
    });
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
  getDisplayPlaces,
  getDistanceKm,
  getNearbyPlaces,
  normalizePlace,
  parsePlacesCsv,
  placesToImportDocuments,
  placesToMarkers
};
