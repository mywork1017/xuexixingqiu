const MAP_DOT_CANVAS_SIZE = 48;

function drawMapDotIcon(meta, selected = false) {
  if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
    return Promise.reject(new Error('canvas api unavailable'));
  }

  const canvasSize = selected ? MAP_DOT_CANVAS_SIZE * 5 : MAP_DOT_CANVAS_SIZE;
  const scale = selected ? 4 : 1;
  const canvas = wx.createOffscreenCanvas({
    type: '2d',
    width: canvasSize,
    height: canvasSize
  });
  const context = canvas.getContext('2d');
  const center = canvasSize / 2;

  context.clearRect(0, 0, canvasSize, canvasSize);
  context.beginPath();
  context.arc(center, center, 17 * scale, 0, Math.PI * 2);
  context.shadowColor = selected ? 'rgba(0, 0, 0, 1)' : 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = selected ? 40 : 5;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = selected ? 10 : 2;
  context.fillStyle = meta.markerStyle === 'inverse' ? '#ffffff' : meta.color;
  context.fill();
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = selected ? 12 : 4;
  context.strokeStyle = meta.markerStyle === 'inverse' ? meta.color : '#ffffff';
  context.stroke();

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: canvasSize,
      height: canvasSize,
      destWidth: canvasSize,
      destHeight: canvasSize,
      fileType: 'png',
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

module.exports = { drawMapDotIcon };
