const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

test('后台只编辑现有点位，不含新增、删除或图片识别入口', () => {
  const listView = read('admin/app/places/places-page-view.tsx');
  const table = read('admin/app/places/places-client.tsx');
  const actions = read('admin/app/places/actions.ts');
  const editor = read('admin/app/places/place-editor.tsx');
  const environment = read('admin/.env.example');

  assert.doesNotMatch(listView, /places\/new|新增地点/);
  assert.doesNotMatch(table, /deletePlaces|删除地点|批量删除/);
  assert.doesNotMatch(actions, /prisma\.place\.create|prisma\.place\.delete/);
  assert.match(actions, /只能编辑现有地点/);
  assert.doesNotMatch(editor, /extract-from-image|AI 截图|截图识别/);
  assert.doesNotMatch(environment, /IMAGE_EXTRACT|DASHSCOPE|QWEN/i);
  assert.equal(fs.existsSync(path.join(ROOT, 'admin/app/api/admin/places/extract-from-image')), false);
});

test('后台和命令行只推送变化或云端缺失的地点', () => {
  for (const file of ['admin/lib/cloudbase-sync.ts', 'admin/scripts/push-places-to-cloud.mjs']) {
    const source = read(file);
    assert.match(source, /const placesToPush = places\.filter/);
    assert.match(source, /!cloudIds\.has\(place\.id\)/);
    assert.match(source, /place\.pushedFingerprint !== (?:getPlaceFingerprint|fingerprint)\(place\)/);
    assert.match(source, /placesToPush\.slice/);
    assert.doesNotMatch(source, /const batch = places\.slice/);
  }
});

test('小程序只保留有入口页面，运行素材均有代码引用', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.deepEqual(app.pages, ['pages/map/map', 'pages/detail/detail']);

  const miniprogramRoot = path.join(ROOT, 'miniprogram');
  const source = walk(miniprogramRoot)
    .filter((file) => !file.includes(`${path.sep}assets${path.sep}`))
    .filter((file) => /\.(js|json|wxml|wxss)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const assets = walk(path.join(miniprogramRoot, 'assets'));
  for (const asset of assets) {
    assert.match(source, new RegExp(asset.split(path.sep).at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('数据库引用图片全部存在且为正方形', async () => {
  const database = path.join(ROOT, 'admin/prisma/dev.db');
  const photoLimits = JSON.parse(execFileSync('sqlite3', [
    '-json',
    database,
    'SELECT p.category, COUNT(ph.id) AS photoCount FROM Place p LEFT JOIN PlacePhoto ph ON ph.placeId = p.id GROUP BY p.id HAVING photoCount > CASE WHEN p.category = \'自然\' THEN 10 ELSE 5 END'
  ], { encoding: 'utf8' }) || '[]');
  const rows = JSON.parse(execFileSync('sqlite3', [
    '-json',
    database,
    "SELECT url FROM PlacePhoto WHERE url LIKE '/uploads/%' ORDER BY url"
  ], { encoding: 'utf8' }));
  const requireFromAdmin = createRequire(path.join(ROOT, 'admin/package.json'));
  const sharp = requireFromAdmin('sharp');

  assert.deepEqual(photoLimits, []);
  assert.ok(rows.length > 0);
  for (const { url } of rows) {
    const file = path.join(ROOT, 'admin/public', url);
    assert.equal(fs.existsSync(file), true, url);
    const metadata = await sharp(file).metadata();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    assert.equal(width, height, `${url}: ${width}x${height}`);
  }
});
