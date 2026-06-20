const SAMPLE_PLACES = [
  {
    id: 'sample-library-east',
    name: '上海图书馆东馆',
    category: '图书馆',
    latitude: 31.2039,
    longitude: 121.5504,
    address: '上海市浦东新区合欢路300号',
    hours: '9:00-20:30',
    phone: '021-38829588',
    tags: ['公共图书馆', '阅览', '自习'],
    description: '开放式阅读空间，适合查阅资料、安静阅读和短时自习。',
    source: 'sample',
    updatedAt: '2026-06-19'
  },
  {
    id: 'sample-xujiahui-library',
    name: '徐家汇书院',
    category: '图书馆',
    latitude: 31.1931,
    longitude: 121.4342,
    address: '上海市徐汇区漕溪北路158号',
    hours: '9:00-20:30',
    phone: '',
    tags: ['公共图书馆', '阅读'],
    description: '位于徐家汇核心区域，适合阅读、展览参观和学习停留。',
    source: 'sample',
    updatedAt: '2026-06-19'
  },
  {
    id: 'sample-party-service',
    name: '浦东新区党群服务中心',
    category: '党群服务中心',
    latitude: 31.2305,
    longitude: 121.5445,
    address: '上海市浦东新区',
    hours: '以现场公示为准',
    phone: '',
    tags: ['党群服务', '社区活动'],
    description: '提供社区服务、活动空间和便民信息。',
    source: 'sample',
    updatedAt: '2026-06-19'
  },
  {
    id: 'sample-community-canteen',
    name: '静安社区食堂',
    category: '社区食堂',
    latitude: 31.2335,
    longitude: 121.4531,
    address: '上海市静安区',
    hours: '午餐、晚餐时段',
    phone: '',
    tags: ['社区食堂', '便民'],
    description: '适合学习途中就近用餐。',
    source: 'sample',
    updatedAt: '2026-06-19'
  },
  {
    id: 'sample-bookstore',
    name: '思南书局',
    category: '书店',
    latitude: 31.2139,
    longitude: 121.4662,
    address: '上海市黄浦区复兴中路517号',
    hours: '10:00-21:00',
    phone: '',
    tags: ['书店', '阅读'],
    description: '人文气质浓厚的书店空间，适合阅读和选书。',
    source: 'sample',
    updatedAt: '2026-06-19'
  },
  {
    id: 'sample-study-room',
    name: '五角场自习室',
    category: '自习室',
    latitude: 31.3037,
    longitude: 121.5146,
    address: '上海市杨浦区五角场商圈',
    hours: '8:00-22:00',
    phone: '',
    tags: ['自习室', '付费座位'],
    description: '商圈周边自习空间，适合长时间安静学习。',
    source: 'sample',
    updatedAt: '2026-06-19'
  }
];

module.exports = {
  SAMPLE_PLACES
};
