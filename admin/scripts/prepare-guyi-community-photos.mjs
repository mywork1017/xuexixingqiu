import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');
const outputDir = path.join(root, 'tmp/guyi-final-processed');
const jobs = [
  ['01.webp', path.join(root, 'admin/public/uploads/nature-official-final-2026-09-12/f7a5b2d127264c1514a0cf22.webp'), null],
  ['02.webp', path.join(root, 'tmp/garden-candidates/guyi-1.jpg'), { left: 105, top: 0, width: 810, height: 810 }],
  ['03.webp', path.join(root, 'tmp/garden-candidates/guyi-2.jpg'), { left: 0, top: 0, width: 640, height: 640 }],
  ['04.webp', path.join(root, 'tmp/garden-candidates/guyi-3.jpg'), { left: 208, top: 0, width: 829, height: 829 }],
  ['05.webp', path.join(root, 'tmp/garden-candidates/guyi-4.jpg'), { left: 400, top: 260, width: 680, height: 680 }]
];

await mkdir(outputDir, { recursive: true });
for (const [file, input, extract] of jobs) {
  let image = sharp(input, { failOn: 'warning' }).rotate();
  if (extract) image = image.extract(extract);
  const destination = path.join(outputDir, file);
  await image.resize(1200, 1200, { fit: 'fill' }).webp({ quality: 88 }).toFile(destination);
  const metadata = await sharp(destination).metadata();
  console.log(`${file}\t${metadata.width}x${metadata.height}`);
}
