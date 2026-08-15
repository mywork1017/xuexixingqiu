import { createHash } from 'node:crypto';

type FingerprintPlace = {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string;
  hours: string;
  description: string;
  photos: Array<{ url: string }> | string[];
};

export function getPlaceFingerprint(place: FingerprintPlace) {
  const photos = place.photos.map((photo) => (
    typeof photo === 'string' ? photo : photo.url
  ));
  const value = JSON.stringify({
    name: place.name,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    hours: place.hours,
    description: place.description,
    photos
  });
  return createHash('sha256').update(value).digest('hex');
}
