import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');
const reportPath = path.join(projectRoot, 'data', 'research', 'place-photo-curation-2026-08-10.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const useCurated = process.argv.includes('--curated');
const suspiciousOnly = process.argv.includes('--suspicious');
const outputDirectory = path.join(
  projectRoot,
  'data',
  'research',
  `${useCurated ? 'place-photo-curation-qa-clean' : 'place-photo-curation-qa-source'}${suspiciousOnly ? '-suspicious' : ''}`
);
const publicRoot = path.join(projectRoot, 'admin', 'public');
const columns = 5;
const rows = 4;
const imageSize = 260;
const labelHeight = 42;
const tileHeight = imageSize + labelHeight;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelSvg(index, placeName, focus) {
  const first = `${index + 1}. ${placeName}`.slice(0, 22);
  return Buffer.from(
    `<svg width="${imageSize}" height="${labelHeight}">`
    + `<rect width="100%" height="100%" fill="#111"/>`
    + `<text x="7" y="17" font-family="PingFang SC,Arial" font-size="12" fill="white">${escapeXml(first)}</text>`
    + `<text x="7" y="34" font-family="PingFang SC,Arial" font-size="11" fill="#c8b8ff">${escapeXml(focus)}</text>`
    + '</svg>'
  );
}

const photos = report.places.flatMap((place) => place.selected.map((photo) => ({
  ...photo,
  placeId: place.placeId,
  placeName: place.placeName,
  category: place.category,
  url: useCurated ? photo.newUrl : photo.oldUrl
}))).filter((photo) => !suspiciousOnly || photo.score < 1 || photo.explicitWatermarkText?.length);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const manifest = [];
for (let offset = 0; offset < photos.length; offset += perSheet) {
  const batch = photos.slice(offset, offset + perSheet);
  const composites = [];
  for (let index = 0; index < batch.length; index += 1) {
    const photo = batch[index];
    const inputPath = path.join(publicRoot, photo.url);
    const left = (index % columns) * imageSize;
    const top = Math.floor(index / columns) * tileHeight;
    const image = await sharp(inputPath).resize(imageSize, imageSize, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
    composites.push({ input: image, left, top });
    composites.push({ input: labelSvg(offset + index, photo.placeName, photo.focus), left, top: top + imageSize });
    manifest.push({ index: offset + index + 1, sheet: Math.floor(offset / perSheet) + 1, ...photo });
  }
  const sheetNumber = Math.floor(offset / perSheet) + 1;
  const outputPath = path.join(outputDirectory, `sheet-${String(sheetNumber).padStart(2, '0')}.jpg`);
  await sharp({
    create: {
      width: columns * imageSize,
      height: rows * tileHeight,
      channels: 3,
      background: '#ececf0'
    }
  }).composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
}
await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${useCurated ? 'clean' : 'source'} photos ${photos.length}, sheets ${Math.ceil(photos.length / perSheet)}\n`);
