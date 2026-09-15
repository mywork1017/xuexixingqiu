import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');
const researchDirectory = path.join(projectRoot, 'data', 'research', 'nature-places-2026-09-12');
const reportName = process.env.REPORT_NAME || 'photo-preparation-report.json';
const outputPrefix = process.env.QA_PREFIX || 'photo-qa';
const report = JSON.parse(await readFile(path.join(researchDirectory, reportName), 'utf8'));
const records = report.records.filter((record) => record.status === 'prepared');
const columns = Number(process.env.QA_COLUMNS || 3);
const rows = Number(process.env.QA_ROWS || 3);
const imageSize = Number(process.env.QA_IMAGE_SIZE || 400);
const labelHeight = 48;
const tileHeight = imageSize + labelHeight;
const perSheet = columns * rows;

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function labelSvg(index, record) {
  return Buffer.from(`<svg width="${imageSize}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111"/>`
    + `<text x="8" y="30" font-family="PingFang SC,Arial" font-size="16" fill="white">${index + 1}. ${escapeXml(record.name).slice(0, 28)}</text></svg>`);
}

async function generate(kind, pathForRecord, fit = 'contain') {
  const outputDirectory = path.join(researchDirectory, `${outputPrefix}-${kind}`);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const manifest = [];
  for (let offset = 0; offset < records.length; offset += perSheet) {
    const batch = records.slice(offset, offset + perSheet);
    const composites = [];
    for (let index = 0; index < batch.length; index += 1) {
      const record = batch[index];
      const inputPath = path.resolve(projectRoot, pathForRecord(record));
      const image = await sharp(inputPath).resize(imageSize, imageSize, { fit, background: '#d8d8dc' }).jpeg({ quality: 94 }).toBuffer();
      const left = (index % columns) * imageSize;
      const top = Math.floor(index / columns) * tileHeight;
      composites.push({ input: image, left, top });
      composites.push({ input: labelSvg(offset + index, record), left, top: top + imageSize });
      manifest.push({ index: offset + index + 1, sheet: Math.floor(offset / perSheet) + 1, ...record });
    }
    const sheet = Math.floor(offset / perSheet) + 1;
    await sharp({ create: { width: columns * imageSize, height: rows * tileHeight, channels: 3, background: '#ececf0' } })
      .composite(composites).jpeg({ quality: 95 }).toFile(path.join(outputDirectory, `sheet-${String(sheet).padStart(2, '0')}.jpg`));
  }
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await generate('original', (record) => record.originalPath, 'contain');
await generate('final', (record) => record.finalPath, 'cover');
process.stdout.write(`nature photos ${records.length}, sheets ${Math.ceil(records.length / perSheet)} per set\n`);
