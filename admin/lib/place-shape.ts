export const CATEGORY_OPTIONS = ['图书馆', '书店', '自习室', '党群服务中心', '社区食堂'];
export const REVIEW_STATUS_OPTIONS = [
  { value: 'pending', label: '待审核' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已下架' }
];

export type AdminPlaceInput = {
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  description: string;
  facilities: string;
  photos: string[];
  source?: string;
  sourceUrl?: string;
  reviewStatus?: string;
};

export function parseList(value: FormDataEntryValue | null): string[] {
  return String(value || '')
    .split(/[;；,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toMiniProgramPlace(place: {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string;
  hours: string;
  description: string;
  facilities: string;
  source: string;
  updatedAt: Date;
  photos: { url: string }[];
}) {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    hours: place.hours,
    description: place.description,
    facilities: place.facilities,
    photos: place.photos.map((photo) => photo.url),
    source: place.source,
    updatedAt: place.updatedAt.toISOString().slice(0, 10)
  };
}
