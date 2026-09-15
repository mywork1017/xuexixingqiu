const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

test('native maps use the Tencent default base map without custom credentials', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');

  assert.doesNotMatch(mapWxml, /subkey=|layer-style=/);
  assert.doesNotMatch(detailWxml, /subkey=|layer-style=/);
});

test('native maps render without full-map scrim polygons', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const detailJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.js'), 'utf8');

  assert.doesNotMatch(mapWxml, /polygons=/);
  assert.doesNotMatch(detailWxml, /polygons=/);
  assert.doesNotMatch(mapJs, /mapScrimPolygons|MAP_SCRIM_POLYGONS/);
  assert.doesNotMatch(detailJs, /mapScrimPolygons|MAP_SCRIM_POLYGONS/);
});

test('main map reduces visual clutter while detail map keeps Tencent defaults', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');

  assert.match(mapWxml, /enable-3D="\{\{false\}\}"/);
  assert.match(mapWxml, /enable-building="\{\{false\}\}"/);
  assert.match(mapWxml, /enable-traffic="\{\{false\}\}"/);
  assert.match(mapWxml, /enable-poi="\{\{true\}\}"/);
  assert.doesNotMatch(detailWxml, /enable-3D=|enable-building=|enable-poi=|enable-traffic=|show-compass=/);
});

test('card changes keep map center fixed and markers exclude the card-covered area', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const regionChange = mapJs.match(/onRegionChange\(event\) \{([\s\S]*?)\n  \},\n\n  updateVisibleMarkers/);
  const markerTap = mapJs.match(/onMarkerTap\(event\) \{([\s\S]*?)\n  \},\n\n  onMapTap/);

  assert.ok(regionChange);
  assert.ok(markerTap);
  assert.doesNotMatch(regionChange[1], /setData\s*\(\s*\{\s*scale/);
  assert.match(mapJs, /CARD_SWIPE_DURATION_MS = 200/);
  assert.match(mapWxml, /duration="\{\{cardSwipeDuration\}\}"/);
  assert.doesNotMatch(markerTap[1], /animateMapCenterTo|latitude\s*:|longitude\s*:|scale\s*:/);
  assert.match(markerTap[1], /if \(marker\.placeId === selectedPlaceId\) \{\s*this\.ignoreNextMapTap = true;\s*return;/);
  assert.doesNotMatch(mapJs, /MAP_TAP_SETTLE_MS|lastMarkerTapAt|pendingMapTapTimer/);
  assert.doesNotMatch(mapJs, /animateMapCenterTo|getCenterLocation/);
  assert.match(mapJs, /getMapVerticalOcclusionRatios\(this\.data\.navMetrics, cardWillShow\)/);
  assert.match(mapJs, /MARKER_EDGE_GUARD_PX = 28/);
  assert.match(mapJs, /getBoundsInsideVerticalOverlays\([\s\S]*occlusion\.top,[\s\S]*occlusion\.bottom/);
  assert.match(mapJs, /markerPlaceIds: visiblePlaces\.map\(\(place\) => place\.id\)/);
  assert.doesNotMatch(mapJs, /raisedMarkerId|removeMarkers|addMarkers|raiseSelectedMarker/);
  assert.match(mapJs, /event\.type === 'end'/);
  assert.doesNotMatch(mapJs, /selectDefaultVisiblePlace/);
});

test('selected map dot stays enlarged, breathes without alpha flicker, and remains on top', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapDotIconJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/utils/map-dot-icon.js'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const mapDotDrawing = mapDotIconJs.match(/function drawMapDotIcon\(meta, selected = false\) \{([\s\S]*?)\n\}\n\nmodule\.exports/);
  const breathing = mapJs.match(/startSelectedMarkerBreathing\(\) \{([\s\S]*?)\n  \},\n\n  stopSelectedMarkerBreathing/);

  assert.match(mapJs, /shouldAutoSelectVisiblePlace = true/);
  assert.match(mapJs, /shouldAutoSelect \? unorderedDisplayPlaces\[0\] : null/);
  assert.ok(mapDotDrawing);
  assert.match(mapDotDrawing[1], /shadowColor = selected \? 'rgba\(0, 0, 0, 1\)' : 'rgba\(0, 0, 0, 0\.55\)'/);
  assert.match(mapDotDrawing[1], /canvasSize = selected \? MAP_DOT_CANVAS_SIZE \* 5 : MAP_DOT_CANVAS_SIZE/);
  assert.match(mapDotDrawing[1], /shadowBlur = selected \? 40 : 5/);
  assert.match(mapDotDrawing[1], /shadowOffsetY = selected \? 10 : 2/);
  assert.match(mapDotDrawing[1], /lineWidth = selected \? 12 : 4/);
  assert.match(mapJs, /SELECTED_MARKER_MIN_SIZE = 39/);
  assert.match(mapJs, /SELECTED_MARKER_MAX_SIZE = 47/);
  assert.match(mapDotDrawing[1], /fillStyle = meta\.markerStyle === 'inverse' \? '#ffffff' : meta\.color/);
  assert.match(mapDotDrawing[1], /strokeStyle = meta\.markerStyle === 'inverse' \? meta\.color : '#ffffff'/);
  assert.match(mapJs, /require\('\.\.\/\.\.\/utils\/map-dot-icon'\)/);
  assert.doesNotMatch(mapJs, /drawSelectedLabelIcon|selectedLabelIcon/);
  assert.ok(breathing);
  assert.match(breathing[1], /Math\.cos\(progress \* Math\.PI \* 2\)/);
  assert.match(breathing[1], /selectedMarkerBreathSize === size/);
  assert.match(breathing[1], /\.width`\]: size/);
  assert.match(breathing[1], /\.height`\]: size/);
  assert.doesNotMatch(breathing[1], /\.alpha|\.zIndex/);
  assert.match(mapJs, /syncMarkers\(displayPlaces\) \{\s*this\.setData\(\{\s*markers: this\.createMarkers\(displayPlaces\)/);
  assert.match(mapJs, /onHide\(\) \{[\s\S]*stopSelectedMarkerBreathing\(\)/);
  assert.match(mapJs, /onUnload\(\) \{[\s\S]*stopSelectedMarkerBreathing\(\)/);
  assert.match(mapWxss, /\.empty-tip \{[^}]*top: calc\(50% - 240rpx\);[^}]*translate\(-50%, -50%\)/);
  assert.match(mapWxss, /\.empty-tip-text \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap/);
  assert.doesNotMatch(mapWxss, /\.empty-tip-link/);
});

test('user location uses a full-body black figure with a staged drop and rebound', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const placeUtilsJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/utils/place-utils.js'), 'utf8');
  const iconJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/utils/user-location-icon.js'), 'utf8');
  const {
    USER_LOCATION_DROP_FRAMES,
    USER_LOCATION_ICON_CANVAS_HEIGHT,
    USER_LOCATION_ICON_FOOT_Y,
    USER_LOCATION_ICON_ANCHOR_Y,
    interpolateUserLocationFrame
  } = require('../miniprogram/utils/user-location-icon');
  const totalDuration = USER_LOCATION_DROP_FRAMES.reduce((sum, frame) => sum + frame.duration, 0);

  assert.equal(USER_LOCATION_DROP_FRAMES.length, 20);
  assert.ok(USER_LOCATION_DROP_FRAMES[0].offsetY <= -80);
  assert.equal(USER_LOCATION_DROP_FRAMES[0].alpha, 0);
  assert.ok(USER_LOCATION_DROP_FRAMES.slice(1, 6).every((frame, index, frames) => (
    frame.alpha > (index === 0 ? 0 : frames[index - 1].alpha)
  )));
  assert.ok(USER_LOCATION_DROP_FRAMES.some((frame) => frame.scaleY < 0.85));
  assert.ok(USER_LOCATION_DROP_FRAMES.some((frame) => frame.offsetY < 0 && frame.scaleY > 1.1));
  assert.ok(USER_LOCATION_DROP_FRAMES.slice(0, 8).every((frame) => (
    frame.leftArmRaise > frame.rightArmRaise
      && frame.leftKneeBend > frame.rightKneeBend
      && frame.leftLegTuck > frame.rightLegTuck
  )));
  assert.deepEqual(USER_LOCATION_DROP_FRAMES[USER_LOCATION_DROP_FRAMES.length - 1], {
    offsetY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    armRaise: 0,
    shadowScale: 1,
    duration: 0
  });
  assert.ok(totalDuration >= 850 && totalDuration <= 1000);
  assert.equal(USER_LOCATION_ICON_CANVAS_HEIGHT, 176);
  assert.equal(USER_LOCATION_ICON_FOOT_Y, 156);
  assert.ok(USER_LOCATION_ICON_FOOT_Y + USER_LOCATION_DROP_FRAMES[0].offsetY - 64 >= 0);
  assert.ok(USER_LOCATION_ICON_ANCHOR_Y > 0.85 && USER_LOCATION_ICON_ANCHOR_Y < 0.9);
  assert.match(iconJs, /fillStyle = '#000000'/);
  assert.match(iconJs, /drawGroundShadow\(context, frame\)/);
  assert.match(iconJs, /quadraticCurveTo/);
  assert.match(iconJs, /const leftArmRaise = typeof frame\.leftArmRaise/);
  assert.match(iconJs, /const rightLegTuck = typeof frame\.rightLegTuck/);
  assert.match(mapJs, /USER_LOCATION_MARKER_WIDTH = 32/);
  assert.match(mapJs, /USER_LOCATION_MARKER_HEIGHT = 88/);
  assert.match(mapJs, /USER_LOCATION_MARKER_Z_INDEX = 1/);
  assert.match(mapJs, /zIndex: USER_LOCATION_MARKER_Z_INDEX/);
  assert.match(placeUtilsJs, /zIndex: selected \? SELECTED_MARKER_Z_INDEX : 10 \+ originalLayer/);
  assert.match(mapJs, /queueUserLocationDrop\(\)/);
  assert.match(mapJs, /stopUserLocationDrop\(true\)/);
  assert.match(mapJs, /requestUserLocationAnimationFrame\(render\)/);
  assert.match(mapJs, /interpolateUserLocationFrame\(frames, elapsed\)/);
  assert.doesNotMatch(mapJs, /setUserLocationIconFrame/);
  assert.match(mapWxml, /<canvas[\s\S]*id="userLocationAnimationCanvas"[\s\S]*type="2d"/);
  assert.match(mapWxss, /\.user-location-animation-canvas \{[^}]*pointer-events: none;[^}]*position: absolute/);

  const firstTweenFrame = interpolateUserLocationFrame(USER_LOCATION_DROP_FRAMES, 27.5);
  assert.ok(firstTweenFrame.alpha > 0 && firstTweenFrame.alpha < USER_LOCATION_DROP_FRAMES[1].alpha);
  assert.ok(firstTweenFrame.leftArmRaise > firstTweenFrame.rightArmRaise);
});

test('tapping the user-location figure plays a natural in-place jump easter egg', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const iconJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/utils/user-location-icon.js'), 'utf8');
  const { USER_LOCATION_JUMP_FRAMES } = require('../miniprogram/utils/user-location-icon');
  const totalDuration = USER_LOCATION_JUMP_FRAMES.reduce((sum, frame) => sum + frame.duration, 0);
  const markerTap = mapJs.match(/onMarkerTap\(event\) \{([\s\S]*?)\n  \},\n\n  onMapTap/);

  assert.equal(USER_LOCATION_JUMP_FRAMES.length, 14);
  assert.ok(USER_LOCATION_JUMP_FRAMES[0].scaleY < 0.85);
  assert.ok(Math.min(...USER_LOCATION_JUMP_FRAMES.map((frame) => frame.offsetY)) <= -48);
  assert.ok(USER_LOCATION_JUMP_FRAMES.some((frame) => frame.armRaise >= 15 && frame.kneeBend >= 10));
  assert.ok(USER_LOCATION_JUMP_FRAMES.some((frame) => frame.offsetY === 0 && frame.scaleY <= 0.8));
  assert.ok(totalDuration >= 650 && totalDuration <= 700);
  assert.match(iconJs, /drawUserLocationJumpIconFrames/);
  assert.ok(markerTap);
  assert.match(markerTap[1], /marker\.markerType === 'user-location'/);
  assert.match(markerTap[1], /this\.startUserLocationJump\(\)/);
  assert.match(mapJs, /stopUserLocationJump\(true\)/);
  assert.match(mapJs, /startUserLocationCanvasAnimation\(USER_LOCATION_JUMP_FRAMES, 'jump'\)/);
});

test('location loading spins the high-position figure before the continuous drop', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const iconJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/utils/user-location-icon.js'), 'utf8');

  assert.doesNotMatch(mapJs, /wx\.(?:showLoading|hideLoading)/);
  assert.doesNotMatch(mapWxml, /radar/);
  assert.doesNotMatch(mapWxss, /radar/);
  assert.match(mapWxml, /class="location-button"[\s\S]*?<image class="location-icon"/);
  assert.match(mapJs, /USER_LOCATION_SEARCH_SPIN_DURATION_MS = 720/);
  assert.match(mapJs, /startUserLocationSearchSpin\(\)/);
  assert.match(mapJs, /spinYRotation: shouldFinish \? 0 : cycleProgress \* 360/);
  assert.match(mapJs, /this\.requestUserLocationSearchFinish\(\)/);
  assert.match(mapJs, /this\.userLocationDropPositionReady[\s\S]*this\.userLocationSearchSpinComplete/);
  assert.match(mapJs, /this\.startUserLocationDrop\(true\)/);
  assert.match(mapJs, /const spatialSpinBlend = this\.userLocationSearchStopRequested/);
  assert.doesNotMatch(iconJs, /context\.rotate\(spinYRotation/);
  assert.match(iconJs, /function projectSpatialPoint\(point, sine, cosine\)/);
  assert.match(iconJs, /function drawSpatialSpinningPerson\(context, frame, blend\)/);
  assert.match(iconJs, /const torsoHalfWidth = Math\.sqrt/);
  assert.match(iconJs, /limbs\.filter\(\(limb\) => limb\.depth < 0\)\.forEach\(drawLimb\)/);
  assert.match(iconJs, /limbs\.filter\(\(limb\) => limb\.depth >= 0\)\.forEach\(drawLimb\)/);
  assert.doesNotMatch(iconJs, /shadowColor = 'rgba\(255, 255, 255/);
});

test('detail map uses a coordinate-bound static unselected marker', () => {
  const detailJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.js'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');
  const detailWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxss'), 'utf8');

  assert.match(detailJs, /require\('\.\.\/\.\.\/utils\/map-dot-icon'\)/);
  assert.match(detailJs, /prepareDetailMapMarker\(place\)/);
  assert.match(detailJs, /latitude: place\.latitude,[\s\S]*longitude: place\.longitude/);
  assert.match(detailJs, /width: 22,[\s\S]*height: 22/);
  assert.match(detailWxml, /markers="\{\{detailMapMarkers\}\}"/);
  assert.doesNotMatch(detailWxml, /detail-map-dot|detail-map-hit-area|cover-view/);
  assert.doesNotMatch(detailWxss, /detail-map-dot|detail-map-hit-area/);
});

test('front-end category tabs are three equal-width choices', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const detailWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxss'), 'utf8');

  assert.doesNotMatch(mapWxml, /item\.width|scroll-x/);
  assert.match(mapWxml, /wx:if="\{\{item\.active\}\}" class="category-indicator"/);
  assert.match(mapWxss, /\.category-row \{[^}]*width: 100%/);
  assert.match(mapWxss, /\.category-chip \{[^}]*flex: 1 1 0/);
  assert.match(mapWxss, /\.category-indicator \{[^}]*background: #000000;[^}]*bottom: -2rpx;[^}]*height: 8rpx;[^}]*width: 36rpx/);
  assert.match(detailWxss, /\.nearby-category-chip \{[^}]*flex: 1 1 0/);
  assert.match(mapWxss, /\.category-dot \{[^}]*flex: 0 0 24rpx;[^}]*height: 24rpx;[^}]*width: 24rpx/);
  assert.match(detailWxss, /\.category-dot \{[^}]*flex: 0 0 24rpx;[^}]*height: 24rpx;[^}]*width: 24rpx/);
  assert.match(mapWxss, /\.category-dot\.solid \{[^}]*border: 1px solid #ffffff/);
  assert.match(mapWxss, /\.category-dot\.inverse \{[^}]*border: 1px solid #000000/);
  assert.doesNotMatch(mapWxss, /\.category-dot\.(?:solid|inverse) \{[^}]*box-shadow/);
  assert.doesNotMatch(detailWxss, /\.category-dot\.(?:solid|inverse) \{[^}]*box-shadow/);
});

test('map and detail navigation geometry follows the current interaction rules', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const detailJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.js'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');
  const detailWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxss'), 'utf8');

  assert.match(mapJs, /scale: 13/);
  assert.match(mapJs, /contentOffset = 16/);
  assert.match(mapWxml, /translateY\(\{\{navMetrics\.contentOffset\}\}px\)/);
  assert.match(mapWxss, /\.map-actions\.with-sheet \{[^}]*bottom: calc\(322rpx[^}]*right: 16rpx/);
  assert.match(mapWxss, /\.sheet-action\.secondary-button \{[^}]*background: #f2f2f7;[^}]*border: 0/);
  assert.match(detailWxml, /show-scrollbar="\{\{false\}\}"/);
  assert.match(detailWxml, /wx:if="\{\{place\.displayPhotos\.length\}\}"/);
  assert.match(detailWxml, /class="hero">[\s\S]*class="title"/);
  assert.match(detailWxml, /class="section detail-card info-card">[\s\S]*class="section-title">简介<\/view>[\s\S]*\{\{place\.displayDescription\}\}[\s\S]*class="photo-panel"/);
  assert.doesNotMatch(detailWxml, />位置<\/view>/);
  assert.match(detailWxml, /wx:if="\{\{place\.displayPhotos\.length > 1\}\}"[\s\S]*class="photo-swiper"/);
  assert.match(detailWxml, /class="cover-photo"[^>]*lazy-load="\{\{false\}\}"[^>]*fade-in="\{\{true\}\}"/);
  assert.match(detailWxml, /class="photo-swiper"[\s\S]*indicator-dots="\{\{true\}\}"[\s\S]*autoplay="\{\{true\}\}"[\s\S]*interval="5000"/);
  assert.match(detailWxml, /<image wx:else class="cover-photo"/);
  assert.match(detailJs, /getPlaceDisplayPhotos\(place\)\.slice\(0, place\.category === '自然' \? 10 : 5\)/);
  assert.match(detailJs, /sanitizePlaceDescription\(place\.description\) \|\| '—'/);
  assert.doesNotMatch(detailJs, /hasDescription/);
  assert.match(detailWxss, /\.photo-panel \{[^}]*height: 622rpx/);
  assert.match(detailWxss, /\.photo-panel \{[^}]*border-radius: 24rpx/);
  assert.match(detailWxss, /\.title \{[^}]*text-align: left/);
  assert.match(detailWxss, /\.photo-panel \{[^}]*margin-top: 32rpx/);
  assert.match(detailWxss, /\.photo-swiper, \.cover-photo \{[^}]*height: 622rpx;[^}]*width: 100%/);
  assert.match(detailWxml, /enable-scroll="\{\{false\}\}"[\s\S]*enable-zoom="\{\{false\}\}"/);
  assert.match(detailWxml, /class="detail-map-shell"[^>]*bindtap="openLocation"/);
  assert.match(detailWxml, /\{\{place\.navigationLabel\}\}/);
  assert.match(detailWxml, /class="map-address"[\s\S]*class="detail-map-shell"[\s\S]*class="action-row"/);
  assert.doesNotMatch(detailWxml, /xiangqing_toubu_dz\.png|xiangqing_xinxi_sj\.png/);
  assert.match(detailWxss, /\.detail-map-shell \{[^}]*border-radius: 24rpx;[^}]*height: 280rpx/);
  assert.match(detailWxss, /\.back-button \{[^}]*font-size: 64rpx/);
  assert.match(detailWxss, /\.hero \{[^}]*margin-bottom: 24rpx/);
  assert.match(detailWxss, /\.section \{[^}]*margin-bottom: 24rpx/);
  assert.match(detailWxss, /\.detail-card \{[^}]*background: #ffffff;[^}]*border-radius: 32rpx/);
});

test('map cards swipe through visible places, loop with multiple places, and lock with one place', () => {
  const mapJs = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.js'), 'utf8');
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');

  assert.match(mapWxml, /<swiper[\s\S]*current="\{\{selectedPlaceIndex\}\}"/);
  assert.match(mapWxml, /circular="\{\{displayPlaces\.length > 1\}\}"/);
  assert.match(mapWxml, /disable-touch="\{\{displayPlaces\.length <= 1\}\}"/);
  assert.match(mapWxml, /bindchange="onPlaceCardChange"/);
  assert.doesNotMatch(mapWxml, /class="sheet-distance"/);
  assert.match(mapWxml, /\{\{place\.displayAddress\}\}/);
  assert.match(mapWxml, /<swiper-item>[\s\S]*class="sheet-actions"[\s\S]*data-id="\{\{place\.id\}\}"[\s\S]*<\/swiper-item>/);
  assert.match(mapWxml, /class="sheet-card" data-id="\{\{place\.id\}\}" bindtap="goToDetail"/);
  assert.match(mapWxml, /catchtap="openLocation"/);
  assert.match(mapWxml, /catchtap="goToDetail"/);
  assert.match(mapWxml, /\{\{place\.distanceText \|\| place\.navigationLabel\}\}/);
  assert.match(mapWxml, /src="\/assets\/actions\/map\/ditu_kapian_dh\.png"/);
  assert.match(mapWxss, /\.bottom-sheet \{[^}]*height: 282rpx;[^}]*\}/);
  assert.match(mapWxss, /\.sheet-card \{[^}]*background: #ffffff;[^}]*border-radius: 32rpx;[^}]*margin: 0 8rpx;[^}]*padding: 32rpx 24rpx 24rpx;[^}]*\}/);
  assert.match(mapJs, /onPlaceCardChange\(event\)/);
  assert.match(mapJs, /selectedPlaceIndex = Number\(event\.detail\.current\)/);
  assert.match(mapJs, /selectedPlace: this\.withDisplayState\(selectedPlace\)/);
});

test('map cards show centered names and addresses without hours', () => {
  const mapWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxml'), 'utf8');
  const mapWxss = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/map/map.wxss'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(ROOT_DIR, 'miniprogram/pages/detail/detail.wxml'), 'utf8');

  assert.match(mapWxml, /\{\{place\.displayAddress\}\}/);
  assert.doesNotMatch(mapWxml, /\{\{place\.displayHours\}\}/);
  assert.match(mapWxss, /\.sheet-title \{[^}]*text-align: center/);
  assert.match(mapWxss, /\.sheet-meta-row \{[^}]*justify-content: center/);
  assert.match(detailWxml, /\{\{place\.displayAddress\}\}/);
  assert.match(detailWxml, /\{\{place\.displayHours\}\}/);
});
