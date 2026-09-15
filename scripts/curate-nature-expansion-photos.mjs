#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'admin', 'package.json'));
const sharp = require('sharp');
const researchRoot = path.join(root, 'data/research/nature-expansion-photos-2026-09-13');
const manifestPath = path.join(researchRoot, 'qa-source-v3/manifest.json');
const outputRoot = path.join(researchRoot, 'approved');
const reportPath = path.join(researchRoot, 'approved-report.json');
const rejectedSpec = `
3 9 14 17-19 22 28 31 33 40 42 44 46 49 55-56 58-59 62-64
68-72 78 82 85-86 89 92 102 112 114 116 123-124 126-127
129 136 139-140 147 149-151 160-161 171 173-183 188-191
200-201 205 207-208 240-242 257 259 267 269 275-277 284-285 289 291 293 302 304-305 307 309-310 312 317-321
326-327 330-332 335-339 347-349 353-356 362-367 369-371 374 376-379 382
387-388 393 400 407 420 422-423 427 433 438 443 447
459-461 465 467 472-473 476 484-485 487 492 501-502 510-512
515 521 541 549 551-552 557 559 562 569-570 575
581-582 585 589 595 604 608-612 614 618-621 629 635-636
642 649-650 666 669 674 676 682 684 699 702
708 711 713 725 743 748 752 754-755 762-763 767
769-771 783-784 798 800 804-808 810-811 819 821-822 832
845 847 853-854 856-857 866 875 877-878 885-886 892
897-898 902 934 938 940-941 947-949 953-956
964-968 971 974 988-991 995-996 1004-1005 1007-1009 1013
1028-1029 1038-1042 1045-1048 1054-1057 1074-1075 1077-1079 1083
1092 1102 1104 1116-1117 1120 1125-1127 1130-1133 1140-1142 1144 1150-1152
1161 1178 1186-1188 1201-1202 1204-1206 1211 1216
1217 1221 1224 1226 1228 1230-1232 1244 1252 1254 1257-1261 1263 1269 1272 1276 1278
1281-1284 1288-1289 1293 1296-1297 1307-1308 1310-1312 1315-1322
57 130 270 345 607 820 976 1149 1185 1222 1309
`;

function expand(spec) {
  const values = new Set();
  for (const token of spec.trim().split(/\s+/)) {
    const [start, end = start] = token.split('-').map(Number);
    for (let value = start; value <= end; value += 1) values.add(value);
  }
  return values;
}

const rejected = expand(rejectedSpec);
const source = JSON.parse(await readFile(manifestPath, 'utf8'));
const approved = source.filter((record) => !rejected.has(record.index));
const images = [];
const placeCounts = new Map();

for (const record of approved) {
  const sourcePath = path.resolve(root, record.finalPath || record.url);
  const metadata = await sharp(sourcePath).metadata();
  const insetX = Math.max(1, Math.round((metadata.width || 0) * 0.08));
  const insetY = Math.max(1, Math.round((metadata.height || 0) * 0.08));
  const width = Math.max(1, (metadata.width || 0) - insetX * 2);
  const height = Math.max(1, (metadata.height || 0) - insetY * 2);
  const placeCount = (placeCounts.get(record.placeId) || 0) + 1;
  placeCounts.set(record.placeId, placeCount);
  const destinationDir = path.join(outputRoot, record.placeId);
  const destination = path.join(destinationDir, `${String(placeCount).padStart(2, '0')}.webp`);
  await mkdir(destinationDir, { recursive: true });
  await sharp(sourcePath)
    .extract({ left: insetX, top: insetY, width, height })
    .resize(1024, 1024, { fit: 'cover', position: 'attention' })
    .webp({ quality: 86 })
    .toFile(destination);
  const relativePath = path.relative(root, destination);
  images.push({
    ...record,
    id: `natureexp_${createHash('sha1').update(`${record.placeId}|${record.sourceUrl}`).digest('hex').slice(0, 24)}`,
    url: relativePath,
    finalPath: relativePath,
    review: 'approved-full-frame-and-text',
  });
}

await writeFile(reportPath, `${JSON.stringify({
  sourceCount: source.length,
  rejectedCount: source.length - approved.length,
  approvedCount: approved.length,
  approvedPlaces: placeCounts.size,
  rejectedIndices: [...rejected].sort((a, b) => a - b),
  images,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ source: source.length, rejected: source.length - approved.length, approved: approved.length, places: placeCounts.size })}\n`);
