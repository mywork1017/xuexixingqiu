export const CATEGORY_OPTIONS = ['图书馆', '食堂'];

export type AdminPlaceInput = {
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  description: string;
  photos: string[];
};

export function parseList(value: FormDataEntryValue | null): string[] {
  return String(value || '')
    .split(/[;；,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isExcludedSchoolPlace(value: { name?: string } | string) {
  const name = typeof value === 'string' ? value : String(value.name || '');
  return /(大学|学院|学校|校区|小学|中学|初中|高中|幼儿园|九年一贯制|十二年一贯制|中等职业|职校|技校)/.test(name);
}

export function isRestrictedInstitutionPlace(value: { name?: string } | string) {
  const name = typeof value === 'string' ? value : String(value.name || '');
  return /(机关|政府(?!路)|委员会|管理局|税务局|公安局|检察院|法院|公司|集团|银行|医院|部队|军队|协会|商会|工会|企业|职工)/.test(name);
}

export function isExcludedPlaceType(value: { name?: string } | string) {
  const name = typeof value === 'string' ? value : String(value.name || '');
  if (name === '阅闲坊') return true;
  if (/(书房|图书室|阅读空间|借阅点|流动图书)/.test(name) && !/图书馆/.test(name)) return true;
  return /(党群|党建)/.test(name) && !/图书馆/.test(name);
}

export function isEligibleCanteenName(value: { name?: string } | string) {
  const name = typeof value === 'string' ? value : String(value.name || '');
  const publicMealService = /(社区|长者|老年|市民|邻里|天平里|天平新里|众乐山|食尚书舍|助餐(?:点|服务|食堂))/.test(name);
  if (!publicMealService) return false;
  return !/(自选大食堂|自助大食堂)/.test(name);
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
    photos: place.photos.map((photo) => photo.url),
    updatedAt: place.updatedAt.toISOString().slice(0, 10)
  };
}
