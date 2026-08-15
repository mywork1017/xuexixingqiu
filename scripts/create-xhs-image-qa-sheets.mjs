import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../admin/package.json', import.meta.url));
const sharp = require('sharp');
const projectRoot = process.cwd();
const researchDirectory = path.join(projectRoot, 'data', 'research', 'xhs-full-2022-2026-08-02');
const stateDirectory = path.join(researchDirectory, 'places');
const outputDirectory = path.join(researchDirectory, 'image-qa');
const columns = 5;
const rows = 6;
const tileSize = 180;
const perSheet = columns * rows;
const includeAllImages = process.env.XHS_QA_ALL === '1';

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelSvg(index, name) {
  const label = `${index + 1}. ${name}`.slice(0, 18);
  return Buffer.from(
    `<svg width="${tileSize}" height="${tileSize}">`
    + `<rect x="0" y="${tileSize - 30}" width="${tileSize}" height="30" fill="rgba(0,0,0,.72)"/>`
    + `<text x="8" y="${tileSize - 10}" font-family="PingFang SC,Arial" font-size="13" fill="white">${escapeXml(label)}</text>`
    + '</svg>'
  );
}

const files = (await readdir(stateDirectory)).filter((file) => file.endsWith('.json')).sort();
const places = [];
for (const file of files) {
  const item = JSON.parse(await readFile(path.join(stateDirectory, file), 'utf8'));
  if (item.status !== 'verified' || !item.images?.length) continue;
  const images = includeAllImages ? item.images : item.images.slice(0, 1);
  images.forEach((image, imageIndex) => {
    places.push({
      id: item.place.id,
      name: `${item.place.name} ${imageIndex + 1}`,
      imagePath: path.join(projectRoot, 'admin', 'public', image.url)
    });
  });
}

await mkdir(outputDirectory, { recursive: true });
for (let offset = 0; offset < places.length; offset += perSheet) {
  const batch = places.slice(offset, offset + perSheet);
  const composites = [];
  for (let index = 0; index < batch.length; index += 1) {
    const place = batch[index];
    const image = await sharp(place.imagePath)
      .resize(tileSize, tileSize, { fit: 'cover' })
      .composite([{ input: labelSvg(offset + index, place.name) }])
      .webp({ quality: 82 })
      .toBuffer();
    composites.push({
      input: image,
      left: (index % columns) * tileSize,
      top: Math.floor(index / columns) * tileSize
    });
  }
  const sheetNumber = Math.floor(offset / perSheet) + 1;
  const prefix = includeAllImages ? 'all-sheet' : 'sheet';
  const outputPath = path.join(outputDirectory, `${prefix}-${String(sheetNumber).padStart(2, '0')}.webp`);
  await sharp({
    create: {
      width: columns * tileSize,
      height: rows * tileSize,
      channels: 3,
      background: '#ececf0'
    }
  }).composite(composites).webp({ quality: 84 }).toFile(outputPath);
  process.stdout.write(`${outputPath}\n`);
}
process.stdout.write(`点位 ${places.length}，质检表 ${Math.ceil(places.length / perSheet)}\n`);
