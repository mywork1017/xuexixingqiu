const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

test('map style config exposes the Tencent location key and dark style id', () => {
  const { MAP_STYLE_CONFIG } = require('../miniprogram/config/map-style');

  assert.equal(MAP_STYLE_CONFIG.subkey, 'HPRBZ-VMEYH-I7KDW-WXCV7-I3JBV-ODBCU');
  assert.equal(MAP_STYLE_CONFIG.layerStyle, 1);
});

test('native map components bind the shared subkey and layer style', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');

  assert.match(mapWxml, /subkey="\{\{mapStyle\.subkey\}\}"/);
  assert.match(mapWxml, /layer-style="\{\{mapStyle\.layerStyle\}\}"/);
  assert.match(detailWxml, /subkey="\{\{mapStyle\.subkey\}\}"/);
  assert.match(detailWxml, /layer-style="\{\{mapStyle\.layerStyle\}\}"/);
});
