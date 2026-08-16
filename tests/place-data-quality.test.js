const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('人工简介可直接用于详情页', () => {
  const sourcePath = path.join(
    __dirname,
    '../data/research/facility-description-web-crawl-2026-08-09/curated-facility-descriptions.json'
  );
  const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const ids = new Set();
  for (const entry of payload.descriptions) {
    assert.ok(entry.description);
    assert.equal(ids.has(entry.id), false);
    ids.add(entry.id);
    assert.doesNotMatch(entry.description, /[。！？；;，,.!?]$/);
    assert.doesNotMatch(entry.description, /小红书|大众点评|百度|高德|腾讯地图|微博|谷歌|Google/i);
    assert.doesNotMatch(entry.description, /想读书|想学习|想自习|想阅读|适合读书|适合学习|适合自习|适合阅读/);
    assert.equal(entry.description.includes(entry.nameForAudit), false);
    for (const evidence of entry.evidence || []) {
      assert.equal(fs.existsSync(path.resolve(path.dirname(sourcePath), evidence)), true);
    }
  }
});

test('人工营业时间都有明确时段和可回查证据', () => {
  const sourcePath = path.join(
    __dirname,
    '../data/research/facility-description-web-crawl-2026-08-09/curated-place-hours.json'
  );
  const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const ids = new Set();
  for (const entry of payload.hours) {
    assert.equal(ids.has(entry.id), false);
    ids.add(entry.id);
    assert.match(entry.hours, /\d{1,2}:\d{2}/);
    assert.doesNotMatch(entry.hours, /现场公示/);
    for (const evidence of entry.evidence || []) {
      assert.equal(fs.existsSync(path.resolve(path.dirname(sourcePath), evidence)), true);
    }
  }
});

test('地址候选必须匹配道路和门牌号', async () => {
  const { scoreMapCandidate } = await import('../scripts/lib/place-data-quality.mjs');
  const result = scoreMapCandidate(
    { name: '浦东图书馆', address: '上海市浦东新区前程路88号' },
    { name: '上海浦东图书馆(总馆)', address: '上海市浦东新区前程路88号' }
  );
  assert.equal(result.accepted, true);
});

test('错误门牌坐标候选被拒绝', async () => {
  const { scoreMapCandidate } = await import('../scripts/lib/place-data-quality.mjs');
  const result = scoreMapCandidate(
    { name: '浦东图书馆', address: '上海市浦东新区前程路88号' },
    { name: '上海浦东图书馆', address: '上海市浦东新区合欢路300号' }
  );
  assert.equal(result.accepted, false);
});

test('道路别名和门牌范围可匹配', async () => {
  const { scoreMapCandidate } = await import('../scripts/lib/place-data-quality.mjs');
  assert.equal(scoreMapCandidate(
    { name: '宣桥镇图书馆', address: '上海市浦东新区下盐路3824号' },
    { name: '宣桥镇社区文化活动中心', address: '上海市浦东新区下盐公路3824号' }
  ).accepted, true);
  assert.equal(scoreMapCandidate(
    { name: '静安区图书馆', address: '上海市静安区新闸路1708号' },
    { name: '静安区图书馆', address: '上海市静安区新闸路1702-1708号' }
  ).accepted, true);
});

test('同路不同门牌仍被拒绝', async () => {
  const { scoreMapCandidate } = await import('../scripts/lib/place-data-quality.mjs');
  assert.equal(scoreMapCandidate(
    { name: '天平路街道图书馆', address: '上海市徐汇区岳阳路77弄20号' },
    { name: '岳阳路小区', address: '上海市徐汇区岳阳路200弄20号' }
  ).accepted, false);
});

test('复合场所只有名称明确包含图书馆时才允许收录', async () => {
  const { auditPlaceRecord, isExcludedPlaceType } = await import('../scripts/lib/place-data-quality.mjs');
  for (const name of [
    '半淞园路街道社区党群服务中心',
    '虹口区科技党建服务中心',
    '茶隐书房',
    '阅闲坊',
    '七棵树微型阅读空间',
    '曹家渡街道达安星之会所图书室',
    '公共流动图书车借阅点'
  ]) {
    assert.equal(isExcludedPlaceType(name), true);
    assert.ok(auditPlaceRecord({
      name,
      category: '图书馆',
      address: '上海市黄浦区福州路100号',
      latitude: 31.23,
      longitude: 121.48
    }).includes('excluded_place_type'));
  }
  for (const name of ['枫林党群服务中心图书馆', '老西门社区文化中心图书馆']) {
    assert.equal(isExcludedPlaceType(name), false);
    assert.equal(auditPlaceRecord({
      name,
      category: '图书馆',
      address: '上海市黄浦区福州路100号',
      latitude: 31.23,
      longitude: 121.48
    }).includes('excluded_place_type'), false);
  }
});

test('学校、单位和机关内部点位被审计阻断', async () => {
  const { auditPlaceRecord } = await import('../scripts/lib/place-data-quality.mjs');
  const rows = [
    ['复旦大学图书馆', 'school_library'],
    ['黄浦区机关图书馆', 'restricted_institution'],
    ['某集团职工食堂', 'restricted_institution']
  ];
  for (const [name, issue] of rows) {
    assert.ok(auditPlaceRecord({
      name,
      category: name.includes('食堂') ? '食堂' : '图书馆',
      address: '上海市黄浦区福州路100号',
      latitude: 31.23,
      longitude: 121.48
    }).includes(issue));
  }
  assert.equal(auditPlaceRecord({
    name: '长海路街道图书馆（政府路馆）',
    category: '图书馆',
    address: '上海市杨浦区政府路78号',
    latitude: 31.31,
    longitude: 121.53
  }).includes('restricted_institution'), false);
});

test('食堂仅允许社区、长者和公益助餐场所', async () => {
  const { auditPlaceRecord, isEligibleCanteenName } = await import('../scripts/lib/place-data-quality.mjs');
  for (const name of ['天平新里社区食堂', '徐家汇街道社区长者食堂', '斜土街道助餐点']) {
    assert.equal(isEligibleCanteenName(name), true);
  }
  for (const name of ['老王自选大食堂', '某某快餐店', '海鲜自助餐厅']) {
    assert.equal(isEligibleCanteenName(name), false);
    assert.ok(auditPlaceRecord({
      name,
      category: '食堂',
      address: '上海市徐汇区漕溪北路100号',
      latitude: 31.19,
      longitude: 121.43
    }).includes('ineligible_canteen'));
  }
});

test('农村自然村门牌可作为完整地址', async () => {
  const { auditPlaceRecord } = await import('../scripts/lib/place-data-quality.mjs');
  const issues = auditPlaceRecord({
    name: '石湖荡镇金汇村社区长者食堂',
    category: '食堂',
    address: '上海市松江区石湖荡镇金汇村金星104号',
    latitude: 30.963561,
    longitude: 121.20031
  });
  assert.equal(issues.includes('missing_street_number'), false);
});

test('苏州公共图书馆和社区助餐点通过城市范围审计', async () => {
  const { auditPlaceRecord, extractDistrict } = await import('../scripts/lib/place-data-quality.mjs');
  const places = [
    {
      name: '苏州图书馆（姑苏分馆）',
      category: '图书馆',
      address: '苏州市姑苏区西环路2115号',
      latitude: 31.31,
      longitude: 120.59
    },
    {
      name: '越溪街道珠村社区幸福食堂',
      category: '食堂',
      address: '苏州市吴中区越溪街道文溪路997号',
      latitude: 31.21,
      longitude: 120.61
    }
  ];
  assert.equal(extractDistrict(places[0].address), '姑苏区');
  for (const place of places) assert.deepEqual(auditPlaceRecord(place), []);
});

test('已移除的地点分类被数据审计阻断', async () => {
  const { auditPlaceRecord } = await import('../scripts/lib/place-data-quality.mjs');
  for (const category of ['自习室', '书店', '党群服务中心', '社区食堂']) {
    assert.ok(auditPlaceRecord({
      name: '测试地点',
      category,
      address: '上海市黄浦区福州路100号',
      latitude: 31.23,
      longitude: 121.48
    }).includes('unsupported_category'));
  }
});
