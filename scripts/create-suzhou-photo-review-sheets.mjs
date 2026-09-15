import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');
const reportPath = path.resolve(process.argv[2] || 'data/research/suzhou-place-completion-2026-08-16/prepare-photo-report.json');
const outputDirectory = path.resolve(process.argv[3] || 'data/research/suzhou-place-completion-2026-08-16/photo-review-sheets');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const columns = 4;
const rows = 3;
const imageSize = 300;
const labelHeight = 84;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelSvg(index, photo) {
  const place = `${index + 1}. ${photo.placeName}`.slice(0, 29);
  const title = String(photo.title || '').slice(0, 34);
  const source = `${photo.channel || ''} ${photo.width || 0}×${photo.height || 0}`;
  return Buffer.from(
    `<svg width="${imageSize}" height="${labelHeight}">`
    + '<rect width="100%" height="100%" fill="#111"/>'
    + `<text x="8" y="20" font-family="PingFang SC,Arial" font-size="13" fill="white">${escapeXml(place)}</text>`
    + `<text x="8" y="43" font-family="PingFang SC,Arial" font-size="11" fill="#d9ccff">${escapeXml(title)}</text>`
    + `<text x="8" y="68" font-family="PingFang SC,Arial" font-size="11" fill="#aaa">${escapeXml(source)}</text>`
    + '</svg>'
  );
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const manifest = [];
for (let offset = 0; offset < report.images.length; offset += perSheet) {
  const batch = report.images.slice(offset, offset + perSheet);
  const composites = [];
  for (let index = 0; index < batch.length; index += 1) {
    const photo = batch[index];
    const left = (index % columns) * imageSize;
    const top = Math.floor(index / columns) * (imageSize + labelHeight);
    const image = await sharp(path.resolve(photo.url))
      .resize(imageSize, imageSize, { fit: 'contain', background: '#ddd' })
      .jpeg({ quality: 92 })
      .toBuffer();
    composites.push({ input: image, left, top });
    composites.push({ input: labelSvg(offset + index, photo), left, top: top + imageSize });
    manifest.push({ index: offset + index + 1, sheet: Math.floor(offset / perSheet) + 1, ...photo });
  }
  const sheet = Math.floor(offset / perSheet) + 1;
  await sharp({
    create: {
      width: columns * imageSize,
      height: rows * (imageSize + labelHeight),
      channels: 3,
      background: '#eee'
    }
  }).composite(composites).jpeg({ quality: 94 }).toFile(path.join(outputDirectory, `sheet-${String(sheet).padStart(2, '0')}.jpg`));
}
await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`photos ${manifest.length}, sheets ${Math.ceil(manifest.length / perSheet)}\n`);
