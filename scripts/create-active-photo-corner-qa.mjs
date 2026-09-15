import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');
const database = path.join(projectRoot, 'admin', 'prisma', 'dev.db');
const publicRoot = path.join(projectRoot, 'admin', 'public');
const outputDirectory = path.join(projectRoot, 'data', 'research', 'place-photo-corner-qa-active');
const fullFrame = process.argv.includes('--full');
const suzhouOnly = process.argv.includes('--suzhou');
const targetNature = process.argv.includes('--target-nature');
const resolvedOutputDirectory = fullFrame
  ? path.join(projectRoot, 'data', 'research', targetNature ? 'target-nature-photo-full-qa-active' : suzhouOnly ? 'suzhou-place-photo-full-qa-active' : 'place-photo-full-qa-active')
  : targetNature ? path.join(projectRoot, 'data', 'research', 'target-nature-photo-corner-qa-active') : outputDirectory;
const photos = JSON.parse(execFileSync('sqlite3', [
  '-json',
  database,
  `SELECT pp.id, pp.placeId, p.name AS placeName, pp.url
   FROM PlacePhoto pp JOIN Place p ON p.id = pp.placeId
   ${targetNature ? "WHERE p.category = '自然' AND (p.address LIKE '上海市%' OR p.address LIKE '苏州市%' OR p.address LIKE '苏州高新区%')" : suzhouOnly ? "WHERE p.name LIKE '苏州图书馆%' OR p.name LIKE '苏州书房%' OR pp.url LIKE '/uploads/suzhou-2026-08-16/%'" : ''}
   ORDER BY p.name, pp.sortOrder, pp.id`
], { encoding: 'utf8' }));

const columns = 5;
const rows = 4;
const imageSize = 260;
const labelHeight = 34;
const tileHeight = imageSize + labelHeight;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelSvg(index, placeName) {
  return Buffer.from(
    `<svg width="${imageSize}" height="${labelHeight}">`
    + '<rect width="100%" height="100%" fill="#111"/>'
    + `<text x="7" y="22" font-family="PingFang SC,Arial" font-size="12" fill="white">${index + 1}. ${escapeXml(placeName).slice(0, 23)}</text>`
    + '</svg>'
  );
}

await rm(resolvedOutputDirectory, { recursive: true, force: true });
await mkdir(resolvedOutputDirectory, { recursive: true });
const manifest = [];
for (let offset = 0; offset < photos.length; offset += perSheet) {
  const batch = photos.slice(offset, offset + perSheet);
  const composites = [];
  for (let index = 0; index < batch.length; index += 1) {
    const photo = batch[index];
    const inputPath = path.join(publicRoot, photo.url);
    const metadata = await sharp(inputPath).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    const cropWidth = Math.max(1, Math.round(width * 0.45));
    const cropHeight = Math.max(1, Math.round(height * 0.45));
    const pipeline = sharp(inputPath);
    if (!fullFrame) {
      pipeline.extract({ left: width - cropWidth, top: height - cropHeight, width: cropWidth, height: cropHeight });
    }
    const image = await pipeline
      .resize(imageSize, imageSize, { fit: fullFrame ? 'cover' : 'fill' })
      .jpeg({ quality: 92 })
      .toBuffer();
    const left = (index % columns) * imageSize;
    const top = Math.floor(index / columns) * tileHeight;
    composites.push({ input: image, left, top });
    composites.push({ input: labelSvg(offset + index, photo.placeName), left, top: top + imageSize });
    manifest.push({ index: offset + index + 1, sheet: Math.floor(offset / perSheet) + 1, ...photo });
  }
  const sheet = Math.floor(offset / perSheet) + 1;
  await sharp({
    create: {
      width: columns * imageSize,
      height: rows * tileHeight,
      channels: 3,
      background: '#ececf0'
    }
  }).composite(composites).jpeg({ quality: 94 }).toFile(
    path.join(resolvedOutputDirectory, `sheet-${String(sheet).padStart(2, '0')}.jpg`)
  );
}
await writeFile(path.join(resolvedOutputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${fullFrame ? 'full' : 'corner'} active photos ${photos.length}, sheets ${Math.ceil(photos.length / perSheet)}\n`);
