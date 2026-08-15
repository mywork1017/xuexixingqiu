import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const researchDirectory = path.join(
  projectRoot,
  'data',
  'research',
  'xhs-full-2022-2026-08-02'
);
const stateDirectory = path.join(researchDirectory, 'places');
const curationPath = path.join(researchDirectory, 'image-curation.json');
const reportPath = path.join(researchDirectory, 'image-curation-result.json');
const curation = JSON.parse(await readFile(curationPath, 'utf8'));
const changes = [];

for (const [placeId, selectedIndexes] of Object.entries(curation.selections || {})) {
  const statePath = path.join(stateDirectory, `${placeId}.json`);
  const item = JSON.parse(await readFile(statePath, 'utf8'));
  const before = item.images || [];
  const selected = selectedIndexes
    .map((index) => before[Number(index)])
    .filter(Boolean);
  item.images = selected;
  item.imageCuration = {
    reviewedAt: new Date().toISOString(),
    selectedIndexes,
    reason: '人工检查地点相关性、文字遮挡和首图质量'
  };
  await writeFile(statePath, `${JSON.stringify(item, null, 2)}\n`);
  changes.push({
    id: placeId,
    name: item.place.name,
    before: before.map((image) => image.url),
    after: selected.map((image) => image.url)
  });
}

await writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  changes
}, null, 2)}\n`);
process.stdout.write(`图片质检调整 ${changes.length} 个地点\n${reportPath}\n`);
