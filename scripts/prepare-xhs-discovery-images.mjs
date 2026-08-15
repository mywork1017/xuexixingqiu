import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../admin/package.json', import.meta.url));
const sharp = require('sharp');
const projectRoot = process.cwd();
const researchDirectory = path.join(
  projectRoot,
  process.env.XHS_DISCOVERY_OUTPUT_DIR || 'data/research/xhs-discovery-2022-2026-08-08'
);
const candidatesPath = path.join(researchDirectory, 'candidates.json');
const preparedPath = path.join(researchDirectory, 'prepared-candidates.json');
const uploadDirectory = path.join(
  projectRoot,
  'admin',
  'public',
  'uploads',
  'xhs-discovery'
);

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

async function prepareCandidate(candidate) {
  const candidateDirectory = path.join(uploadDirectory, candidate.noteId);
  await mkdir(candidateDirectory, { recursive: true });
  const qualified = [];
  const sources = [...new Map(
    (candidate.images || []).map((image) => [image.url, image])
  ).values()].slice(0, 12);

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    try {
      const raw = await downloadImage(source.url);
      const metadata = await sharp(raw).rotate().metadata();
      const width = Number(metadata.width) || 0;
      const height = Number(metadata.height) || 0;
      const ratio = width / Math.max(1, height);
      if (Math.min(width, height) < 720 || ratio < 0.45 || ratio > 2.2) continue;
      const stats = await sharp(raw).rotate().stats();
      if (stats.entropy < 2.5) continue;
      qualified.push({
        raw,
        source,
        score: Math.min(width, height) + stats.entropy * 100 - (index === 0 ? 180 : 0)
      });
    } catch {
      // A failed or low-quality source image does not block candidate review.
    }
  }

  const photos = [];
  for (const [index, image] of qualified
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}.webp`;
    await sharp(image.raw)
      .rotate()
      .resize(1080, 1080, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toFile(path.join(candidateDirectory, filename));
    photos.push({
      url: `/uploads/xhs-discovery/${candidate.noteId}/${filename}`,
      sourceUrl: image.source.url
    });
  }
  return { ...candidate, photos };
}

const payload = JSON.parse(await readFile(candidatesPath, 'utf8'));
const newCandidates = process.env.XHS_DISCOVERY_INCLUDE_ALL === '1'
  ? payload.candidates
  : payload.candidates.filter((candidate) => candidate.status === 'new_candidate');
const prepared = [];
for (let index = 0; index < newCandidates.length; index += 1) {
  const candidate = await prepareCandidate(newCandidates[index]);
  prepared.push(candidate);
  process.stdout.write(
    `准备 ${index + 1}/${newCandidates.length}：${candidate.name} 图 ${candidate.photos.length}\n`
  );
}
await writeFile(preparedPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourcePolicy: payload.sourcePolicy,
  candidates: prepared
}, null, 2)}\n`);
process.stdout.write(`${preparedPath}\n`);
