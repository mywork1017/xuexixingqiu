const USER_LOCATION_ICON_CANVAS_WIDTH = 64;
const USER_LOCATION_ICON_CANVAS_HEIGHT = 176;
const USER_LOCATION_ICON_FOOT_Y = 156;
const USER_LOCATION_ICON_ANCHOR_Y = USER_LOCATION_ICON_FOOT_Y / USER_LOCATION_ICON_CANVAS_HEIGHT;
const USER_LOCATION_FRAME_KEYS = Object.freeze([
  'offsetY',
  'alpha',
  'rotation',
  'scaleX',
  'scaleY',
  'armRaise',
  'elbowBend',
  'kneeBend',
  'legTuck',
  'leftArmRaise',
  'rightArmRaise',
  'leftElbowBend',
  'rightElbowBend',
  'leftKneeBend',
  'rightKneeBend',
  'leftLegTuck',
  'rightLegTuck',
  'shadowScale'
]);
const USER_LOCATION_FRAME_FALLBACKS = Object.freeze({
  leftArmRaise: 'armRaise',
  rightArmRaise: 'armRaise',
  leftElbowBend: 'elbowBend',
  rightElbowBend: 'elbowBend',
  leftKneeBend: 'kneeBend',
  rightKneeBend: 'kneeBend',
  leftLegTuck: 'legTuck',
  rightLegTuck: 'legTuck'
});

const USER_LOCATION_DROP_FRAMES = Object.freeze([
  { offsetY: -88, alpha: 0, rotation: -8, scaleX: 0.96, scaleY: 1, armRaise: 12, leftArmRaise: 18, rightArmRaise: 6, leftElbowBend: 5, rightElbowBend: 8, leftKneeBend: 9, rightKneeBend: 3, leftLegTuck: 12, rightLegTuck: 3, shadowScale: 0.06, duration: 55 },
  { offsetY: -88, alpha: 0.16, rotation: -8, scaleX: 0.96, scaleY: 1, armRaise: 12, leftArmRaise: 18, rightArmRaise: 6, leftElbowBend: 5, rightElbowBend: 8, leftKneeBend: 9, rightKneeBend: 3, leftLegTuck: 12, rightLegTuck: 3, shadowScale: 0.08, duration: 55 },
  { offsetY: -86, alpha: 0.34, rotation: -7, scaleX: 0.96, scaleY: 1, armRaise: 12, leftArmRaise: 18, rightArmRaise: 7, leftElbowBend: 5, rightElbowBend: 8, leftKneeBend: 9, rightKneeBend: 3, leftLegTuck: 12, rightLegTuck: 3, shadowScale: 0.1, duration: 52 },
  { offsetY: -82, alpha: 0.56, rotation: -6, scaleX: 0.97, scaleY: 1.01, armRaise: 12, leftArmRaise: 17, rightArmRaise: 7, leftElbowBend: 5, rightElbowBend: 7, leftKneeBend: 9, rightKneeBend: 3, leftLegTuck: 11, rightLegTuck: 4, shadowScale: 0.14, duration: 50 },
  { offsetY: -76, alpha: 0.78, rotation: -4, scaleX: 0.97, scaleY: 1.02, armRaise: 11, leftArmRaise: 16, rightArmRaise: 7, leftElbowBend: 5, rightElbowBend: 7, leftKneeBend: 8, rightKneeBend: 3, leftLegTuck: 10, rightLegTuck: 4, shadowScale: 0.2, duration: 48 },
  { offsetY: -68, alpha: 0.94, rotation: -2, scaleX: 0.98, scaleY: 1.03, armRaise: 11, leftArmRaise: 15, rightArmRaise: 8, leftElbowBend: 5, rightElbowBend: 6, leftKneeBend: 8, rightKneeBend: 3, leftLegTuck: 9, rightLegTuck: 4, shadowScale: 0.28, duration: 46 },
  { offsetY: -58, alpha: 1, rotation: 1, scaleX: 0.98, scaleY: 1.03, armRaise: 10, leftArmRaise: 14, rightArmRaise: 8, leftElbowBend: 4, rightElbowBend: 6, leftKneeBend: 7, rightKneeBend: 3, leftLegTuck: 8, rightLegTuck: 4, shadowScale: 0.38, duration: 44 },
  { offsetY: -46, alpha: 1, rotation: 3, scaleX: 0.98, scaleY: 1.03, armRaise: 9, leftArmRaise: 12, rightArmRaise: 8, leftElbowBend: 4, rightElbowBend: 5, leftKneeBend: 6, rightKneeBend: 3, leftLegTuck: 7, rightLegTuck: 4, shadowScale: 0.48, duration: 42 },
  { offsetY: -32, alpha: 1, rotation: 2, scaleX: 0.99, scaleY: 1.04, armRaise: 7, leftArmRaise: 9, rightArmRaise: 6, leftElbowBend: 3, rightElbowBend: 4, leftKneeBend: 5, rightKneeBend: 3, leftLegTuck: 5, rightLegTuck: 3, shadowScale: 0.6, duration: 40 },
  { offsetY: -18, alpha: 1, rotation: 1, scaleX: 0.99, scaleY: 1.05, armRaise: 5, leftArmRaise: 6, rightArmRaise: 4, leftElbowBend: 2, rightElbowBend: 3, leftKneeBend: 4, rightKneeBend: 2, leftLegTuck: 3, rightLegTuck: 2, shadowScale: 0.74, duration: 38 },
  { offsetY: -7, alpha: 1, rotation: 0, scaleX: 0.98, scaleY: 1.08, armRaise: 3, leftArmRaise: 4, rightArmRaise: 3, leftElbowBend: 1, rightElbowBend: 2, leftKneeBend: 3, rightKneeBend: 2, leftLegTuck: 1, rightLegTuck: 0, shadowScale: 0.88, duration: 36 },
  { offsetY: -1, alpha: 1, rotation: -1, scaleX: 0.98, scaleY: 1.08, armRaise: 2, elbowBend: 1, kneeBend: 1, legTuck: 0, shadowScale: 0.96, duration: 32 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1.18, scaleY: 0.78, armRaise: -2, kneeBend: 5, shadowScale: 1, duration: 72 },
  { offsetY: -9, alpha: 1, rotation: 1, scaleX: 0.94, scaleY: 1.12, armRaise: 2, shadowScale: 0.78, duration: 54 },
  { offsetY: -5, alpha: 1, rotation: 0, scaleX: 0.98, scaleY: 1.05, armRaise: 1, shadowScale: 0.88, duration: 48 },
  { offsetY: 0, alpha: 1, rotation: -1, scaleX: 1.07, scaleY: 0.9, armRaise: -1, kneeBend: 2, shadowScale: 1, duration: 54 },
  { offsetY: -2, alpha: 1, rotation: 0, scaleX: 0.98, scaleY: 1.04, armRaise: 1, shadowScale: 0.94, duration: 48 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1.02, scaleY: 0.97, armRaise: 0, shadowScale: 1, duration: 52 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 0.99, scaleY: 1.01, armRaise: 0, shadowScale: 1, duration: 48 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1, scaleY: 1, armRaise: 0, shadowScale: 1, duration: 0 }
]);

const USER_LOCATION_JUMP_FRAMES = Object.freeze([
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1.12, scaleY: 0.82, armRaise: -2, kneeBend: 5, shadowScale: 1.08, duration: 70 },
  { offsetY: -10, alpha: 1, rotation: -1, scaleX: 0.94, scaleY: 1.15, armRaise: 4, kneeBend: 2, shadowScale: 0.82, duration: 45 },
  { offsetY: -24, alpha: 1, rotation: -2, scaleX: 0.97, scaleY: 1.08, armRaise: 8, kneeBend: 4, shadowScale: 0.66, duration: 45 },
  { offsetY: -37, alpha: 1, rotation: -1, scaleX: 0.99, scaleY: 1.03, armRaise: 12, kneeBend: 7, shadowScale: 0.52, duration: 50 },
  { offsetY: -46, alpha: 1, rotation: 1, scaleX: 1, scaleY: 1, armRaise: 14, kneeBend: 9, shadowScale: 0.44, duration: 55 },
  { offsetY: -48, alpha: 1, rotation: 2, scaleX: 1, scaleY: 1, armRaise: 15, kneeBend: 10, shadowScale: 0.42, duration: 65 },
  { offsetY: -44, alpha: 1, rotation: 1, scaleX: 1, scaleY: 1.01, armRaise: 14, kneeBend: 9, shadowScale: 0.46, duration: 55 },
  { offsetY: -32, alpha: 1, rotation: 0, scaleX: 0.99, scaleY: 1.03, armRaise: 11, kneeBend: 7, shadowScale: 0.56, duration: 45 },
  { offsetY: -18, alpha: 1, rotation: -1, scaleX: 0.98, scaleY: 1.06, armRaise: 7, kneeBend: 4, shadowScale: 0.72, duration: 40 },
  { offsetY: -5, alpha: 1, rotation: 0, scaleX: 0.97, scaleY: 1.09, armRaise: 3, kneeBend: 2, shadowScale: 0.9, duration: 35 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1.16, scaleY: 0.8, armRaise: -2, kneeBend: 5, shadowScale: 1.08, duration: 70 },
  { offsetY: -4, alpha: 1, rotation: 0, scaleX: 0.96, scaleY: 1.08, armRaise: 2, kneeBend: 1, shadowScale: 0.9, duration: 50 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1.04, scaleY: 0.94, armRaise: 0, shadowScale: 1.02, duration: 50 },
  { offsetY: 0, alpha: 1, rotation: 0, scaleX: 1, scaleY: 1, armRaise: 0, shadowScale: 1, duration: 0 }
]);

function drawGroundShadow(context, frame) {
  const scale = frame.shadowScale;
  context.save();
  context.globalAlpha = frame.alpha;
  context.translate(USER_LOCATION_ICON_CANVAS_WIDTH / 2, USER_LOCATION_ICON_FOOT_Y + 3);
  context.scale(scale, 0.34);
  context.beginPath();
  context.arc(0, 0, 17, 0, Math.PI * 2);
  context.fillStyle = `rgba(0, 0, 0, ${0.08 + (scale * 0.18)})`;
  context.fill();
  context.restore();
}

function projectSpatialPoint(point, sine, cosine) {
  const x = (point.x * cosine) + (point.z * sine);
  const depth = (-point.x * sine) + (point.z * cosine);
  const perspective = 1 + (depth * 0.008);
  return {
    x: x * perspective,
    y: -32 + ((point.y + 32) * perspective),
    depth
  };
}

function drawSpatialSpinningPerson(context, frame, blend) {
  const armRaise = frame.armRaise || 0;
  const leftArmRaise = typeof frame.leftArmRaise === 'number' ? frame.leftArmRaise : armRaise;
  const rightArmRaise = typeof frame.rightArmRaise === 'number' ? frame.rightArmRaise : armRaise;
  const legTuck = frame.legTuck || 0;
  const leftLegTuck = typeof frame.leftLegTuck === 'number' ? frame.leftLegTuck : legTuck;
  const rightLegTuck = typeof frame.rightLegTuck === 'number' ? frame.rightLegTuck : legTuck;
  const radians = frame.spinYRotation * Math.PI / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const point = (x, y, z) => projectSpatialPoint({ x, y, z }, sine, cosine);
  const limbs = [
    {
      width: 6.5,
      points: [
        point(-6, -38, 1),
        point(-14, -34 - (leftArmRaise * 0.45), 5),
        point(-11, -22 - leftArmRaise, 10)
      ]
    },
    {
      width: 6.5,
      points: [
        point(6, -38, -1),
        point(14, -34 - (rightArmRaise * 0.35), -5),
        point(11, -22 - rightArmRaise, -10)
      ]
    },
    {
      width: 7.5,
      points: [
        point(-3, -22, 1),
        point(-10, -12 - (leftLegTuck * 0.4), 5),
        point(-7, -leftLegTuck, 10)
      ]
    },
    {
      width: 7.5,
      points: [
        point(3, -22, -1),
        point(10, -10 - (rightLegTuck * 0.3), -5),
        point(8, -rightLegTuck, -10)
      ]
    }
  ].map((limb) => ({
    ...limb,
    depth: limb.points.reduce((sum, item) => sum + item.depth, 0) / limb.points.length
  })).sort((first, second) => first.depth - second.depth);

  context.save();
  context.globalAlpha = frame.alpha * blend;
  context.translate(
    USER_LOCATION_ICON_CANVAS_WIDTH / 2,
    USER_LOCATION_ICON_FOOT_Y + frame.offsetY
  );
  context.rotate(frame.rotation * Math.PI / 180);
  context.scale(frame.scaleX, frame.scaleY);
  context.fillStyle = '#000000';
  context.strokeStyle = '#000000';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const drawLimb = (limb) => {
    context.lineWidth = limb.width * (1 + (limb.depth * 0.006));
    context.beginPath();
    context.moveTo(limb.points[0].x, limb.points[0].y);
    context.quadraticCurveTo(
      limb.points[1].x,
      limb.points[1].y,
      limb.points[2].x,
      limb.points[2].y
    );
    context.stroke();
  };

  limbs.filter((limb) => limb.depth < 0).forEach(drawLimb);

  const torsoHalfWidth = Math.sqrt(
    ((8 * cosine) ** 2) + ((5 * sine) ** 2)
  );
  const hipHalfWidth = Math.sqrt(
    ((5 * cosine) ** 2) + ((3.5 * sine) ** 2)
  );
  context.beginPath();
  context.moveTo(-torsoHalfWidth, -42);
  context.quadraticCurveTo(0, -47, torsoHalfWidth, -42);
  context.lineTo(hipHalfWidth, -22);
  context.quadraticCurveTo(0, -18, -hipHalfWidth, -22);
  context.closePath();
  context.fill();

  limbs.filter((limb) => limb.depth >= 0).forEach(drawLimb);

  context.beginPath();
  context.arc(0, -54, 9.5, 0, Math.PI * 2);
  context.fill();
  if (Math.abs(sine) > 0.12) {
    context.beginPath();
    context.arc(Math.sign(sine) * 8.5, -53, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawFlatPerson(context, frame, blend = 1) {
  const armRaise = frame.armRaise || 0;
  const elbowBend = frame.elbowBend || 0;
  const kneeBend = frame.kneeBend || 0;
  const legTuck = frame.legTuck || 0;
  const leftArmRaise = typeof frame.leftArmRaise === 'number' ? frame.leftArmRaise : armRaise;
  const rightArmRaise = typeof frame.rightArmRaise === 'number' ? frame.rightArmRaise : armRaise;
  const leftElbowBend = typeof frame.leftElbowBend === 'number' ? frame.leftElbowBend : elbowBend;
  const rightElbowBend = typeof frame.rightElbowBend === 'number' ? frame.rightElbowBend : elbowBend;
  const leftKneeBend = typeof frame.leftKneeBend === 'number' ? frame.leftKneeBend : kneeBend;
  const rightKneeBend = typeof frame.rightKneeBend === 'number' ? frame.rightKneeBend : kneeBend;
  const leftLegTuck = typeof frame.leftLegTuck === 'number' ? frame.leftLegTuck : legTuck;
  const rightLegTuck = typeof frame.rightLegTuck === 'number' ? frame.rightLegTuck : legTuck;

  context.save();
  context.globalAlpha = frame.alpha * blend;
  context.translate(
    USER_LOCATION_ICON_CANVAS_WIDTH / 2,
    USER_LOCATION_ICON_FOOT_Y + frame.offsetY
  );
  context.rotate(frame.rotation * Math.PI / 180);
  context.scale(frame.scaleX, frame.scaleY);
  context.fillStyle = '#000000';
  context.strokeStyle = '#000000';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(-4, -22);
  context.quadraticCurveTo(-8 - leftKneeBend, -12 - (leftLegTuck * 0.55), -10 - (leftLegTuck * 0.12), -8 - leftLegTuck);
  context.quadraticCurveTo(-12 - (leftKneeBend * 0.25), -4 - (leftLegTuck * 0.45), -11 + (leftLegTuck * 0.2), -leftLegTuck);
  context.moveTo(4, -22);
  context.quadraticCurveTo(8 + rightKneeBend, -12 - (rightLegTuck * 0.55), 10 + (rightLegTuck * 0.12), -8 - rightLegTuck);
  context.quadraticCurveTo(12 + (rightKneeBend * 0.25), -4 - (rightLegTuck * 0.45), 11 - (rightLegTuck * 0.2), -rightLegTuck);
  context.stroke();

  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(-7, -38);
  context.quadraticCurveTo(-15 - leftElbowBend, -34 - (leftArmRaise * 0.58), -15 - leftElbowBend, -30 - (leftArmRaise * 0.72));
  context.quadraticCurveTo(-18 - (leftElbowBend * 0.25), -27 - (leftArmRaise * 0.82), -17 + (leftElbowBend * 0.15), -22 - leftArmRaise);
  context.moveTo(7, -38);
  context.quadraticCurveTo(15 + rightElbowBend, -34 - (rightArmRaise * 0.58), 15 + rightElbowBend, -30 - (rightArmRaise * 0.72));
  context.quadraticCurveTo(18 + (rightElbowBend * 0.25), -27 - (rightArmRaise * 0.82), 17 - (rightElbowBend * 0.15), -22 - rightArmRaise);
  context.stroke();

  context.beginPath();
  context.moveTo(-8, -42);
  context.quadraticCurveTo(0, -47, 8, -42);
  context.lineTo(7, -22);
  context.quadraticCurveTo(0, -18, -7, -22);
  context.closePath();
  context.fill();

  context.beginPath();
  context.arc(0, -54, 9.5, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawPerson(context, frame) {
  if (typeof frame.spinYRotation !== 'number') {
    drawFlatPerson(context, frame);
    return;
  }

  const spatialBlend = typeof frame.spatialSpinBlend === 'number'
    ? frame.spatialSpinBlend
    : 1;
  if (spatialBlend > 0) {
    drawSpatialSpinningPerson(context, frame, spatialBlend);
  }
  if (spatialBlend < 1) {
    drawFlatPerson(context, frame, 1 - spatialBlend);
  }
}

function drawUserLocationFrameToContext(context, frame) {
  context.clearRect(0, 0, USER_LOCATION_ICON_CANVAS_WIDTH, USER_LOCATION_ICON_CANVAS_HEIGHT);
  drawGroundShadow(context, frame);
  drawPerson(context, frame);
}

function getFrameValue(frame, key) {
  if (typeof frame[key] === 'number') {
    return frame[key];
  }
  const fallbackKey = USER_LOCATION_FRAME_FALLBACKS[key];
  if (fallbackKey && typeof frame[fallbackKey] === 'number') {
    return frame[fallbackKey];
  }
  if (key === 'alpha' || key === 'scaleX' || key === 'scaleY' || key === 'shadowScale') {
    return 1;
  }
  return 0;
}

function interpolateUserLocationFrame(frames, elapsedMs) {
  if (!Array.isArray(frames) || !frames.length) {
    return null;
  }

  let frameStart = 0;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    const duration = Math.max(0, Number(frame.duration || 0));
    if (elapsedMs <= frameStart + duration) {
      const nextFrame = frames[index + 1];
      const progress = duration > 0 ? Math.max(0, Math.min(1, (elapsedMs - frameStart) / duration)) : 1;
      return USER_LOCATION_FRAME_KEYS.reduce((result, key) => {
        const startValue = getFrameValue(frame, key);
        const endValue = getFrameValue(nextFrame, key);
        result[key] = startValue + ((endValue - startValue) * progress);
        return result;
      }, {});
    }
    frameStart += duration;
  }

  return USER_LOCATION_FRAME_KEYS.reduce((result, key) => {
    result[key] = getFrameValue(frames[frames.length - 1], key);
    return result;
  }, {});
}

function drawUserLocationIconFrame(frame) {
  if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
    return Promise.reject(new Error('canvas api unavailable'));
  }

  const canvas = wx.createOffscreenCanvas({
    type: '2d',
    width: USER_LOCATION_ICON_CANVAS_WIDTH,
    height: USER_LOCATION_ICON_CANVAS_HEIGHT
  });
  const context = canvas.getContext('2d');

  drawUserLocationFrameToContext(context, frame);

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: USER_LOCATION_ICON_CANVAS_WIDTH,
      height: USER_LOCATION_ICON_CANVAS_HEIGHT,
      destWidth: USER_LOCATION_ICON_CANVAS_WIDTH,
      destHeight: USER_LOCATION_ICON_CANVAS_HEIGHT,
      fileType: 'png',
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

function drawUserLocationIconFrames(frames = USER_LOCATION_DROP_FRAMES) {
  return frames.reduce((task, frame) => task.then((paths) => (
    drawUserLocationIconFrame(frame).then((iconPath) => paths.concat(iconPath))
  )), Promise.resolve([]));
}

function drawUserLocationJumpIconFrames() {
  return drawUserLocationIconFrames(USER_LOCATION_JUMP_FRAMES);
}

module.exports = {
  USER_LOCATION_DROP_FRAMES,
  USER_LOCATION_JUMP_FRAMES,
  USER_LOCATION_ICON_CANVAS_WIDTH,
  USER_LOCATION_ICON_CANVAS_HEIGHT,
  USER_LOCATION_ICON_FOOT_Y,
  USER_LOCATION_ICON_ANCHOR_Y,
  drawUserLocationIconFrame,
  drawUserLocationIconFrames,
  drawUserLocationJumpIconFrames,
  drawUserLocationFrameToContext,
  interpolateUserLocationFrame
};
