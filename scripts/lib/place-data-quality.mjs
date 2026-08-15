export const SHANGHAI_DISTRICTS = [
  '浦东新区',
  '黄浦区',
  '徐汇区',
  '长宁区',
  '静安区',
  '普陀区',
  '虹口区',
  '杨浦区',
  '闵行区',
  '宝山区',
  '嘉定区',
  '金山区',
  '松江区',
  '青浦区',
  '奉贤区',
  '崇明区'
];

export const SUPPORTED_CATEGORIES = ['图书馆', '食堂'];

const DISTRICT_PATTERN = new RegExp(SHANGHAI_DISTRICTS.join('|'));
const SCHOOL_PATTERN = /(大学|学院|学校|校区|小学|中学|初中|高中|幼儿园|九年一贯制|十二年一贯制|中等职业|职校|技校)/;
const RESTRICTED_INSTITUTION_PATTERN = /(机关|政府(?!路)|委员会|管理局|税务局|公安局|检察院|法院|公司|集团|银行|医院|部队|军队|协会|商会|工会|企业|职工)/;
const ROAD_NUMBER_PATTERN = /([^区县\d,，/()（）]{1,30}(?:公路|大道|路|街|道|弄|巷|村))\s*(\d+)(?:\s*[-—至到]\s*(\d+))?(?:\s*弄\s*(\d+))?\s*号?/g;

export function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/上海市?|社区|街道|乡|镇|文化活动中心|文化中心|服务中心|分馆|馆/g, '')
    .replace(/[·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

export function normalizeAddress(value) {
  return cleanText(value)
    .replace(/^上海市?/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[，,。.、:：;；/\\_\-—]/g, '');
}

export function extractDistrict(value) {
  return cleanText(value).match(DISTRICT_PATTERN)?.[0] || '';
}

function normalizeRoadName(value) {
  return String(value || '')
    .replace(/^.*?(?:区|县)/, '')
    .replace(/^.*?(?:街道|镇|乡)/, '')
    .replace(/公路$|大道$/, '路');
}

export function extractRoadNumbers(value) {
  const address = cleanText(value)
    .replace(/^上海市?/, '')
    .replace(/[，,。.、:：;；\\_—]/g, '')
    .replace(/临时服务点[:：]?/g, '');
  return [...address.matchAll(ROAD_NUMBER_PATTERN)].map((match) => ({
    road: normalizeRoadName(match[1]),
    numbers: [match[2], match[3]].filter(Boolean),
    lane: match[4] || ''
  }));
}

export function extractRoadNumber(value) {
  const match = extractRoadNumbers(value)[0];
  if (!match) return '';
  return `${match.road}${match.numbers[0]}${match.lane ? `弄${match.lane}` : ''}`;
}

export function isExcludedSchoolLibrary(name) {
  return SCHOOL_PATTERN.test(cleanText(name));
}

export function isRestrictedInstitutionPlace(name) {
  return RESTRICTED_INSTITUTION_PATTERN.test(cleanText(name));
}

export function isExcludedPlaceType(name) {
  const value = cleanText(name);
  if (value === '阅闲坊') return true;
  if (/(书房|图书室|阅读空间|借阅点|流动图书)/.test(value) && !/图书馆/.test(value)) return true;
  return /(党群|党建)/.test(value) && !/图书馆/.test(value);
}

export function isEligibleCanteenName(name) {
  const value = cleanText(name);
  const publicMealService = /(社区|长者|老年|市民|邻里|睦邻|天平里|天平新里|众乐山|食尚书舍|助餐(?:点|服务|食堂))/.test(value);
  return publicMealService && !/(自选大食堂|自助大食堂)/.test(value);
}

export function distanceMeters(first, second) {
  const values = [
    first?.latitude,
    first?.longitude,
    second?.latitude,
    second?.longitude
  ].map(Number);
  if (!values.every(Number.isFinite)) return Infinity;
  const [lat1, lon1, lat2, lon2] = values;
  const radians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * radians;
  const deltaLon = (lon2 - lon1) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreMapCandidate(place, candidate) {
  const inputDistrict = extractDistrict(place.address);
  const candidateDistrict = extractDistrict(candidate.address);
  const inputRoadNumbers = extractRoadNumbers(place.address);
  const candidateRoadNumbers = extractRoadNumbers(candidate.address);
  const leftName = normalizeName(place.name);
  const rightName = normalizeName(candidate.name);
  const districtMatch = !inputDistrict || !candidateDistrict || inputDistrict === candidateDistrict;
  const streetNumberMatch = inputRoadNumbers.some((input) => (
    candidateRoadNumbers.some((candidateValue) => {
      const sameRoad = input.road === candidateValue.road
        || input.road.endsWith(candidateValue.road)
        || candidateValue.road.endsWith(input.road);
      const sameHouseNumber = input.numbers.some((number) => candidateValue.numbers.includes(number));
      const sameLane = !input.lane || !candidateValue.lane || input.lane === candidateValue.lane;
      return sameRoad && sameHouseNumber && sameLane;
    })
  ));
  const nameMatch = Boolean(leftName)
    && Boolean(rightName)
    && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName));

  let score = 0;
  if (districtMatch) score += 15;
  if (streetNumberMatch) score += 60;
  if (nameMatch) score += 25;
  if (!streetNumberMatch && normalizeAddress(place.address) === normalizeAddress(candidate.address)) score += 60;

  return {
    score,
    districtMatch,
    streetNumberMatch,
    nameMatch,
    accepted: districtMatch && streetNumberMatch && score >= 75
  };
}

export function auditPlaceRecord(place) {
  const issues = [];
  const structuredAddressLocator = /(?:花园|宅)\d+号|村[^,，]*\d+(?:组[^,，]*\d+)?号|(?:路|街|弄).*(?:交叉口|地铁站).{0,12}\d+米|(?:小区|花园|公寓|大楼|大厦|中心|广场|菜市场|园区|邻里中心).*(?:门|楼|层|旁).{0,12}(?:\d+米)?|(?:村|苑|酒店|园|城|工业区).{0,20}(?:门|旁).{0,10}(?:\d+米)?/.test(cleanText(place.address));
  if (!cleanText(place.name)) issues.push('missing_name');
  if (!cleanText(place.address)) issues.push('missing_address');
  if (!SUPPORTED_CATEGORIES.includes(place.category)) issues.push('unsupported_category');
  if (!extractDistrict(place.address)) issues.push('missing_district');
  if (!extractRoadNumber(place.address) && !structuredAddressLocator) issues.push('missing_street_number');
  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) issues.push('invalid_coordinates');
  if (
    Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && (latitude < 30.6 || latitude > 31.9 || longitude < 120.8 || longitude > 122.2)
  ) {
    issues.push('outside_shanghai_bounds');
  }
  if (place.category === '图书馆' && isExcludedSchoolLibrary(place.name)) issues.push('school_library');
  if (isRestrictedInstitutionPlace(place.name)) issues.push('restricted_institution');
  if (isExcludedPlaceType(place.name)) issues.push('excluded_place_type');
  if (place.category === '食堂' && !isEligibleCanteenName(place.name)) issues.push('ineligible_canteen');
  return issues;
}
