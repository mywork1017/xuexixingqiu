import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const require = createRequire(new URL('../admin/package.json', import.meta.url));
const sharp = require('sharp');
const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const researchDirectory = path.join(projectRoot, 'data', 'research', 'xhs-xuhui-huangpu');
const reviewDirectory = path.join('/tmp', 'xhs-pilot-review');
const evidencePath = path.join(researchDirectory, 'evidence.json');
const pilotEvidencePath = path.join(researchDirectory, 'pilot-evidence.json');
const publicUploadDirectory = path.join(projectRoot, 'admin', 'public', 'uploads', 'xhs-pilot');
const cutoffTime = Date.parse('2024-08-02T00:00:00+08:00');
const xhsCommand = process.env.XHS_COMMAND || 'xhs';

const places = [
  {
    slug: 'hongmei-library',
    kind: 'existing',
    targetName: '虹梅路街道图书馆',
    additionalLive: [{ query: '虹梅街道党群服务中心 图书馆', noteId: '690c9d2c0000000005033010' }]
  },
  {
    slug: 'dapu-library',
    kind: 'existing',
    targetName: '打浦桥街道图书馆',
    additionalDiscovery: ['6a1777f100000000350382bd']
  },
  {
    slug: 'bund-canteen',
    kind: 'existing',
    targetName: '外滩街道社区长者食堂',
    additionalLive: [{ query: '外滩街道社区长者食堂', noteId: '698aa60e000000001a022b29' }]
  },
  {
    slug: 'wuliqiao-canteen',
    kind: 'existing',
    targetName: '五里桥街道社区长者食堂',
    additionalDiscovery: ['674ae043000000000703652d']
  },
  {
    slug: 'xuhong-canteen',
    kind: 'discovery',
    noteIds: ['6919775a000000000503b053', '66de89a3000000002603f563']
  },
  {
    slug: 'laoximen-canteen',
    kind: 'discovery',
    noteIds: ['6767deff000000000800e71e', '69a54e9d000000001a02043c']
  },
  {
    slug: 'cervantes-library',
    kind: 'live',
    query: '上海塞万提斯图书馆',
    noteIds: ['6a101a6f0000000008024e1f', '6a03cfdb0000000035032182']
  },
  {
    slug: 'dengdeng-library',
    kind: 'live',
    query: '上海当代艺术博物馆 等等图书馆',
    noteIds: ['6a066ef5000000000802653b']
  }
];
const selectedImageIndexes = {
  'hongmei-library': [4, 7, 8, 9],
  'dapu-library': [1, 7, 10],
  'bund-canteen': [1, 2],
  'wuliqiao-canteen': [0, 3, 5],
  'xuhong-canteen': [0, 3, 7, 10],
  'laoximen-canteen': [1, 2, 4],
  'cervantes-library': [0, 3, 5],
  'dengdeng-library': [0, 1, 4, 6]
};

function getSearchRows(payload) {
  return Array.isArray(payload)
    ? payload.filter((row) => /^[a-f0-9]{24}$/i.test(String(row?.id || '')))
    : [];
}

function toEvidence(row, query) {
  const note = row.note;
  return {
    query,
    noteId: String(note.noteId || ''),
    title: String(note.title || '').trim(),
    body: String(note.desc || '').trim(),
    publishedAt: new Date(Number(note.time)).toISOString(),
    images: Array.isArray(note.imageList)
      ? note.imageList.map((image) => ({
        url: String(image.urlDefault || image.url || ''),
        width: Number(image.width) || null,
        height: Number(image.height) || null
      })).filter((image) => image.url)
      : []
  };
}

async function runXhs(args) {
  const { stdout } = await execFileAsync(xhsCommand, args, {
    cwd: projectRoot,
    maxBuffer: 100 * 1024 * 1024,
    timeout: 90_000
  });
  return JSON.parse(stdout);
}

async function getLiveNote(query, noteId) {
  const cachePath = path.join('/tmp', `${noteId}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    if (String(cached?.note?.noteId) === noteId) return toEvidence(cached, query);
  } catch {
    // Search with xhs-cli when no cache is available.
  }

  const rows = getSearchRows(await runXhs(['search', query, '--json']));
  const row = rows.find((candidate) => String(candidate.id) === noteId);
  if (!row) throw new Error(`小红书搜索未返回笔记 ${noteId}`);
  const args = ['read', noteId];
  if (row.xsecToken) args.push('--xsec-token', String(row.xsecToken));
  args.push('--json');
  const detail = await runXhs(args);
  return toEvidence(detail, query);
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      Referer: 'https://www.xiaohongshu.com/',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function imageLabel(index) {
  return Buffer.from(
    `<svg width="240" height="240"><rect x="8" y="8" width="50" height="34" rx="8" fill="rgba(0,0,0,.72)"/>`
    + `<text x="33" y="32" text-anchor="middle" font-family="Arial" font-size="22" fill="white">${index}</text></svg>`
  );
}

async function createReviewSheet(slug, sources) {
  const imageDirectory = path.join(reviewDirectory, slug);
  await mkdir(imageDirectory, { recursive: true });
  const images = sources.flatMap((source) => source.images.map((image) => ({
    ...image,
    noteId: source.noteId
  })));
  const tiles = [];
  const manifestImages = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    try {
      const raw = await downloadImage(image.url);
      const rawPath = path.join(imageDirectory, `${String(index).padStart(2, '0')}.source`);
      await writeFile(rawPath, raw);
      const tile = await sharp(raw)
        .rotate()
        .resize(240, 240, { fit: 'cover', position: 'attention' })
        .composite([{ input: imageLabel(index) }])
        .webp({ quality: 80 })
        .toBuffer();
      tiles.push({ input: tile, left: (index % 4) * 240, top: Math.floor(index / 4) * 240 });
      manifestImages.push({ index, ...image, rawPath });
    } catch (error) {
      process.stderr.write(`${slug} 图片 ${index} 跳过：${error.message}\n`);
    }
  }

  if (tiles.length) {
    const rows = Math.ceil(images.length / 4);
    await sharp({
      create: { width: 960, height: rows * 240, channels: 3, background: '#e8e8e8' }
    }).composite(tiles).webp({ quality: 82 }).toFile(path.join(reviewDirectory, `${slug}-contact.webp`));
  }
  return manifestImages;
}

async function createFinalImages(slug, images) {
  const selected = selectedImageIndexes[slug] || [];
  const outputDirectory = path.join(publicUploadDirectory, slug);
  await mkdir(outputDirectory, { recursive: true });
  const finalImages = [];

  for (let outputIndex = 0; outputIndex < selected.length; outputIndex += 1) {
    const sourceIndex = selected[outputIndex];
    const source = images.find((image) => image.index === sourceIndex);
    if (!source) throw new Error(`${slug} 缺少候选图 ${sourceIndex}`);
    const filename = `${String(outputIndex + 1).padStart(2, '0')}.webp`;
    const outputPath = path.join(outputDirectory, filename);
    await sharp(source.rawPath)
      .rotate()
      .resize(1080, 1080, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toFile(outputPath);
    finalImages.push({
      sourceIndex,
      sourceNoteId: source.noteId,
      url: `/uploads/xhs-pilot/${slug}/${filename}`,
      width: 1080,
      height: 1080
    });
  }
  return finalImages;
}

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const output = {
  generatedAt: new Date().toISOString(),
  cutoffDate: '2024-08-02',
  sourcePolicy: 'xhs-cli 正文与正文配图；未读取评论',
  places: []
};

await mkdir(reviewDirectory, { recursive: true });
for (const place of places) {
  let sources = [];
  if (place.kind === 'existing') {
    const result = evidence.existing.find((item) => item?.evidence?.targetName === place.targetName);
    if (result?.status === 'verified') sources = [result.evidence];
  } else if (place.kind === 'discovery') {
    sources = place.noteIds
      .map((noteId) => evidence.discovery.find((item) => item.noteId === noteId))
      .filter(Boolean);
  } else {
    sources = await Promise.all(place.noteIds.map((noteId) => getLiveNote(place.query, noteId)));
  }
  if (place.additionalLive) {
    const additionalSources = await Promise.all(
      place.additionalLive.map(({ query, noteId }) => getLiveNote(query, noteId))
    );
    sources.push(...additionalSources);
  }
  if (place.additionalDiscovery) {
    const additionalSources = place.additionalDiscovery
      .map((noteId) => evidence.discovery.find((item) => item.noteId === noteId))
      .filter(Boolean);
    sources.push(...additionalSources);
  }

  sources = sources.filter((source) => Date.parse(source.publishedAt) >= cutoffTime);
  if (!sources.length) throw new Error(`${place.slug} 没有近两年正文证据`);
  const images = await createReviewSheet(place.slug, sources);
  const finalImages = await createFinalImages(place.slug, images);
  output.places.push({ slug: place.slug, sources, finalImages });
  process.stdout.write(
    `${place.slug}: ${sources.length} 篇正文，${images.length} 张候选图，${finalImages.length} 张入库图\n`
  );
}

await writeFile(pilotEvidencePath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${pilotEvidencePath}\n${reviewDirectory}\n`);
