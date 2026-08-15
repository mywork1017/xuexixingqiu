const SHANGHAI_CENTER_LOCATION = {
  latitude: 31.2304,
  longitude: 121.4737
};

const SHANGHAI_BOUNDS = {
  southwest: { latitude: 30.65, longitude: 120.85 },
  northeast: { latitude: 31.9, longitude: 122.25 }
};

function isWithinShanghaiBounds(location) {
  const latitude = Number(location && location.latitude);
  const longitude = Number(location && location.longitude);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= SHANGHAI_BOUNDS.southwest.latitude
    && latitude <= SHANGHAI_BOUNDS.northeast.latitude
    && longitude >= SHANGHAI_BOUNDS.southwest.longitude
    && longitude <= SHANGHAI_BOUNDS.northeast.longitude;
}

function isRegionOutsideShanghai(region) {
  if (!region || !region.southwest || !region.northeast) return false;
  return !isWithinShanghaiBounds({
    latitude: (Number(region.southwest.latitude) + Number(region.northeast.latitude)) / 2,
    longitude: (Number(region.southwest.longitude) + Number(region.northeast.longitude)) / 2
  });
}

module.exports = {
  SHANGHAI_BOUNDS,
  SHANGHAI_CENTER_LOCATION,
  isRegionOutsideShanghai,
  isWithinShanghaiBounds
};
