import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = path.join(projectRoot, 'admin', 'prisma', 'dev.db');
const publicRoot = path.join(projectRoot, 'admin', 'public');
const applyChanges = process.argv.includes('--apply');
const require = createRequire(path.join(projectRoot, 'admin', 'package.json'));
const sharp = require('sharp');

function runSqlite(args, options = {}) {
  const result = spawnSync('sqlite3', [databasePath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 exited with status ${result.status}`);
  }
  return result.stdout;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function timestamp() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}`;
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function displayedDimensions(metadata) {
  const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
  return rotated
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

function squareUrl(url) {
  const extension = path.posix.extname(url);
  return `${url.slice(0, -extension.length)}-square${extension}`;
}

const photos = JSON.parse(runSqlite([
  '-json',
  'SELECT id, placeId, url, sortOrder FROM PlacePhoto ORDER BY placeId, sortOrder, id'
]));
const candidates = [];

for (const photo of photos) {
  if (!photo.url.startsWith('/uploads/')) continue;
  const sourcePath = path.resolve(publicRoot, `.${photo.url}`);
  if (!sourcePath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`图片路径越界：${photo.url}`);
  }
  const metadata = await sharp(sourcePath, { failOn: 'error' }).metadata();
  const dimensions = displayedDimensions(metadata);
  if (dimensions.width === dimensions.height) continue;
  candidates.push({
    ...photo,
    sourcePath,
    targetUrl: squareUrl(photo.url),
    targetPath: path.resolve(publicRoot, `.${squareUrl(photo.url)}`),
    format: metadata.format,
    before: dimensions
  });
}

if (!applyChanges) {
  process.stdout.write(`${JSON.stringify({ total: photos.length, square: photos.length - candidates.length, candidates: candidates.map(({ sourcePath, targetPath, ...item }) => item) }, null, 2)}\n`);
  process.exit(0);
}

const runId = timestamp();
const backupRoot = path.join(projectRoot, 'data', 'backups', `place-photos-before-square-${runId}`);
const reportDirectory = path.join(projectRoot, 'data', 'research', 'place-photo-square-crop-2026-08-10');
const databaseBackupPath = path.join(projectRoot, 'data', 'backups', `dev-before-square-photo-crop-${runId}.db`);
await mkdir(backupRoot, { recursive: true });
await mkdir(reportDirectory, { recursive: true });
runSqlite([`.backup ${sqlString(databaseBackupPath)}`]);

const results = [];
for (const candidate of candidates) {
  const relativeSource = path.relative(projectRoot, candidate.sourcePath);
  const backupPath = path.join(backupRoot, relativeSource);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await mkdir(path.dirname(candidate.targetPath), { recursive: true });
  await copyFile(candidate.sourcePath, backupPath);

  const side = Math.min(candidate.before.width, candidate.before.height);
  let pipeline = sharp(candidate.sourcePath, { failOn: 'error' })
    .rotate()
    .resize(side, side, { fit: 'cover', position: 'attention', withoutEnlargement: true });
  if (candidate.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
  } else if (candidate.format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (candidate.format === 'webp') {
    pipeline = pipeline.webp({ quality: 90, effort: 5 });
  }
  await pipeline.toFile(candidate.targetPath);

  const outputMetadata = await sharp(candidate.targetPath, { failOn: 'error' }).metadata();
  const after = displayedDimensions(outputMetadata);
  if (after.width !== after.height) {
    throw new Error(`方形校验失败：${candidate.targetUrl} (${after.width}x${after.height})`);
  }
  results.push({
    photoId: candidate.id,
    placeId: candidate.placeId,
    oldUrl: candidate.url,
    newUrl: candidate.targetUrl,
    before: candidate.before,
    after,
    cropPosition: 'attention',
    originalSha256: await sha256(candidate.sourcePath),
    squareSha256: await sha256(candidate.targetPath),
    backupPath: path.relative(projectRoot, backupPath)
  });
}

if (results.length) {
  const now = Date.now();
  const affectedPlaces = [...new Set(results.map((item) => item.placeId))];
  const statements = [
    'PRAGMA foreign_keys=ON;',
    'BEGIN IMMEDIATE;',
    ...results.map((item) => `UPDATE PlacePhoto SET url = ${sqlString(item.newUrl)} WHERE id = ${sqlString(item.photoId)} AND url = ${sqlString(item.oldUrl)};`),
    `UPDATE Place SET updatedAt = ${now}, pushedFingerprint = '' WHERE id IN (${affectedPlaces.map(sqlString).join(', ')});`,
    'COMMIT;'
  ];
  runSqlite([], { input: `${statements.join('\n')}\n` });
}

const report = {
  createdAt: new Date().toISOString(),
  policy: '现用详情图统一为正方形；非方图按注意力中心裁切，不拉伸、不放大',
  totalActivePhotos: photos.length,
  alreadySquare: photos.length - candidates.length,
  cropped: results.length,
  affectedPlaces: new Set(results.map((item) => item.placeId)).size,
  databaseBackup: path.relative(projectRoot, databaseBackupPath),
  imageBackupRoot: path.relative(projectRoot, backupRoot),
  results
};
const reportPath = path.join(reportDirectory, `report-${runId}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, results: undefined, reportPath: path.relative(projectRoot, reportPath) }, null, 2)}\n`);
