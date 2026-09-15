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

export const SUZHOU_DISTRICTS = [
  '姑苏区',
  '虎丘区',
  '吴中区',
  '相城区',
  '吴江区',
  '苏州工业园区',
  '苏州高新区',
  '常熟市',
  '张家港市',
  '昆山市',
  '太仓市'
];

export const JIAXING_DISTRICTS = [
  '南湖区',
  '秀洲区',
  '嘉善县',
  '海盐县',
  '海宁市',
  '平湖市',
  '桐乡市',
  '嘉兴经开区'
];

export const NANTONG_DISTRICTS = [
  '崇川区',
  '通州区',
  '海门区',
  '海安市',
  '如东县',
  '启东市',
  '如皋市',
  '南通开发区',
  '通州湾示范区',
  '苏锡通园区'
];

export const WUXI_DISTRICTS = [
  '梁溪区',
  '锡山区',
  '惠山区',
  '滨湖区',
  '新吴区',
  '江阴市',
  '宜兴市',
  '无锡经开区'
];

export const ZHENJIANG_DISTRICTS = [
  '京口区',
  '润州区',
  '丹徒区',
  '镇江新区',
  '丹阳市',
  '扬中市',
  '句容市'
];

export const SUPPORTED_CATEGORIES = ['图书馆', '食堂', '自然'];

const DISTRICT_PATTERN = new RegExp([
  ...SHANGHAI_DISTRICTS,
  ...SUZHOU_DISTRICTS,
  ...JIAXING_DISTRICTS,
  ...NANTONG_DISTRICTS,
  ...WUXI_DISTRICTS,
  ...ZHENJIANG_DISTRICTS
].join('|'));
const CITY_PREFIX_PATTERN = /^(?:上海|苏州|嘉兴|南通|无锡|镇江)市?/;
const SCHOOL_PATTERN = /(大学|学院|学校|校区|小学|中学|初中|高中|幼儿园|九年一贯制|十二年一贯制|中等职业|职校|技校)/;
const RESTRICTED_INSTITUTION_PATTERN = /(机关|政府(?!路)|委员会|管理局|税务局|公安局|检察院|法院|公司|集团|银行|医院|部队|军队|协会|商会|工会|企业|职工)/;
const ROAD_NUMBER_PATTERN = /([^区县\d,，/()（）]{1,30}(?:公路|大道|路|街|道|弄|巷|村|里))\s*(\d+)(?:\s*[-—至到]\s*(\d+))?(?:\s*弄\s*(\d+))?\s*号?/g;

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
    .replace(/上海市?|苏州市?|嘉兴市?|南通市?|无锡市?|镇江市?|社区|街道|乡|镇|文化活动中心|文化中心|服务中心|分馆|馆/g, '')
    .replace(/[·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

export function normalizeAddress(value) {
  return cleanText(value)
    .replace(CITY_PREFIX_PATTERN, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[，,。.、:：;；/\\_\-—]/g, '');
}

export function extractDistrict(value) {
  return cleanText(value).match(DISTRICT_PATTERN)?.[0] || '';
}

function normalizeDistrict(value) {
  return value === '苏州高新区' ? '虎丘区' : value;
}

function normalizeRoadName(value) {
  return String(value || '')
    .replace(/^.*?(?:区|县)/, '')
    .replace(/^.*?(?:街道|镇|乡)/, '')
    .replace(/公路$|大道$/, '路');
}

export function extractRoadNumbers(value) {
  const address = cleanText(value)
    .replace(CITY_PREFIX_PATTERN, '')
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
  const publicMealService = /(社区|长者|老年|市民|邻里|睦邻|天平里|天平新里|众乐山|食尚书舍|助餐(?:点|中心|服务|食堂))/.test(value);
  return publicMealService && !/(自选大食堂|自助大食堂)/.test(value);
}

export function isEligibleNatureName(name) {
  const value = cleanText(name);
  const officialTypeFreeName = /^(?:竖新会客厅|桂江路[三四]期|浏缘|梅馨陇韵|美树里|龙游河三期|匠心筑缘|五山片区|濠西书苑休闲区|福巷)$/;
  const publicNaturePlace = /(公园|绿地|绿廊|生态走廊|生态廊道|风光带|景观带|滨水空间|滨江|滨河|湖滨|河畔|湿地|森林|游园|生态园|风景区|景区|步道|绿道|花谷|绿洲|绿岛|花园|植物园|园(?:（.*）)?$|苑$|湾$|广场$|圃$|堤$|(?:山|湖|岛|洲|滩|谷|岭|峰)$)/.test(value)
    || officialTypeFreeName.test(value);
  const excluded = /(小区|住宅|校园|单位内部|高尔夫|私家|市政隔离带|道路中央绿带)/.test(value);
  return publicNaturePlace && !excluded;
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
  const districtMatch = !inputDistrict
    || !candidateDistrict
    || normalizeDistrict(inputDistrict) === normalizeDistrict(candidateDistrict);
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
  const structuredAddressLocator = /(?:花园|宅)\d+号|村[^,，]*\d+(?:组[^,，]*\d+)?号|(?:路|街|弄).*(?:交叉口|地铁站).{0,12}\d+米|(?:地铁|轨交).{0,30}(?:站|口)|(?:小区|花园|公寓|大楼|大厦|中心|广场|菜市场|园区|邻里中心).*(?:门|楼|层|旁).{0,12}(?:\d+米)?|(?:村|苑|酒店|园|城|工业区).{0,20}(?:门|旁).{0,10}(?:\d+米)?/.test(cleanText(place.address));
  const structuredNatureLocator = place.category === '自然'
    && /(?:路|街|巷|弄|大道|公路|村|镇|乡|园|苑|湖|河|浜|港|桥|交叉口|路口|转角|东至|南至|西至|北至|沿线|沿岸|旁|侧|段)/.test(cleanText(place.address));
  if (!cleanText(place.name)) issues.push('missing_name');
  if (!cleanText(place.address)) issues.push('missing_address');
  if (!SUPPORTED_CATEGORIES.includes(place.category)) issues.push('unsupported_category');
  if (!extractDistrict(place.address)) issues.push('missing_district');
  if (!extractRoadNumber(place.address) && !structuredAddressLocator && !structuredNatureLocator) issues.push('missing_street_number');
  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) issues.push('invalid_coordinates');
  const withinShanghai = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 30.6 && latitude <= 31.9
    && longitude >= 120.8 && longitude <= 122.2;
  const withinSuzhou = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 30.7 && latitude <= 32.1
    && longitude >= 119.8 && longitude <= 121.3;
  const withinJiaxing = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 30.25 && latitude <= 31.05
    && longitude >= 120.3 && longitude <= 121.35;
  const withinNantong = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 31.55 && latitude <= 32.75
    && longitude >= 120.2 && longitude <= 122.05;
  const withinWuxi = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 31.05 && latitude <= 32.1
    && longitude >= 119.45 && longitude <= 120.75;
  const withinZhenjiang = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 31.55 && latitude <= 32.4
    && longitude >= 118.9 && longitude <= 119.95;
  if (
    Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && !withinShanghai
    && !withinSuzhou
    && !withinJiaxing
    && !withinNantong
    && !withinWuxi
    && !withinZhenjiang
  ) {
    issues.push('outside_supported_city_bounds');
  }
  if (place.category === '图书馆' && isExcludedSchoolLibrary(place.name)) issues.push('school_library');
  if (isRestrictedInstitutionPlace(place.name)) issues.push('restricted_institution');
  if (isExcludedPlaceType(place.name)) issues.push('excluded_place_type');
  if (place.category === '食堂' && !isEligibleCanteenName(place.name)) issues.push('ineligible_canteen');
  if (place.category === '自然' && !isEligibleNatureName(place.name)) issues.push('ineligible_nature_place');
  return issues;
}
