import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');
const sourceDir = path.join(root, 'tmp/zoo-final-candidates');
const outputDir = path.join(root, 'tmp/zoo-final-processed');

const jobs = [
  ['shanghai-zoo', '01.webp', path.join(root, 'admin/public/uploads/nature-web-shanghai-final-2026-09-12/nature-1af8beebfd1c82b6af9eaf92/02.webp'), null],
  ['shanghai-zoo', '02.webp', path.join(sourceDir, 'zoo-14.jpg'), { left: 120, top: 0, width: 1440, height: 1440 }],
  ['shanghai-zoo', '03.webp', path.join(sourceDir, 'zoo-15.jpg'), null],
  ['shanghai-zoo', '04.webp', path.join(sourceDir, 'zoo-18.jpg'), { left: 480, top: 0, width: 1440, height: 1440 }],
  ['shanghai-zoo', '05.webp', path.join(sourceDir, 'zoo-19.jpg'), { left: 240, top: 0, width: 1440, height: 1440 }],
  ['wild-animal-park', '01.webp', path.join(sourceDir, 'wild-01.jpg'), { left: 834, top: 0, width: 3333, height: 3333 }],
  ['wild-animal-park', '02.webp', path.join(sourceDir, 'wild-02.jpg'), { left: 33, top: 0, width: 1853, height: 1853 }],
  ['wild-animal-park', '03.webp', path.join(sourceDir, 'wild-03.jpg'), { left: 0, top: 120, width: 720, height: 720 }],
  ['wild-animal-park', '04.webp', path.join(sourceDir, 'wild-05.jpg'), { left: 0, top: 420, width: 1126, height: 1126 }],
  ['wild-animal-park', '05.webp', path.join(sourceDir, 'wild-06.jpg'), { left: 0, top: 600, width: 1614, height: 1614 }]
];

for (const [group, file, input, extract] of jobs) {
  const destination = path.join(outputDir, group, file);
  await mkdir(path.dirname(destination), { recursive: true });
  let image = sharp(input, { failOn: 'warning' }).rotate();
  if (extract) image = image.extract(extract);
  await image.resize(1200, 1200, { fit: 'fill' }).webp({ quality: 88 }).toFile(destination);
  const metadata = await sharp(destination).metadata();
  console.log(`${group}/${file}\t${metadata.width}x${metadata.height}`);
}
