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

test('native map scrims render through map polygons under markers', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const detailJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.js'), 'utf8');

  assert.match(mapWxml, /polygons="\{\{mapScrimPolygons\}\}"/);
  assert.match(detailWxml, /polygons="\{\{mapScrimPolygons\}\}"/);
  assert.match(mapJs, /zIndex:\s*20/);
  assert.match(detailJs, /zIndex:\s*20/);
  assert.doesNotMatch(mapWxml, /map-scrim/);
  assert.doesNotMatch(detailWxml, /detail-map-scrim/);
});

test('map gestures keep native center and scale after region changes', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const regionChange = mapJs.match(/onRegionChange\(event\) \{([\s\S]*?)\n  \},\n\n  updateVisibleMarkers/);
  const markerTap = mapJs.match(/onMarkerTap\(event\) \{([\s\S]*?)\n  \},\n\n  onMapTap/);

  assert.ok(regionChange);
  assert.ok(markerTap);
  assert.doesNotMatch(regionChange[1], /setData\s*\(\s*\{\s*scale/);
  assert.doesNotMatch(markerTap[1], /animateMapCenterTo|latitude\s*:|longitude\s*:|scale\s*:/);
  assert.doesNotMatch(mapJs, /animateMapCenterTo|selectDefaultVisiblePlace/);
});
