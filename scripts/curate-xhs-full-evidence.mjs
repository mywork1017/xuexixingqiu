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
const curationPath = path.join(researchDirectory, 'evidence-curation.json');
const reportPath = path.join(researchDirectory, 'evidence-curation-result.json');
const curation = JSON.parse(await readFile(curationPath, 'utf8'));
const changes = [];

for (const [placeId, reason] of Object.entries(curation.rejections || {})) {
  const statePath = path.join(stateDirectory, `${placeId}.json`);
  const item = JSON.parse(await readFile(statePath, 'utf8'));
  changes.push({
    id: placeId,
    name: item.place.name,
    previousStatus: item.status,
    evidenceNoteIds: (item.evidence || []).map((evidence) => evidence.noteId),
    reason
  });
  item.status = 'no_recent_body_evidence';
  item.evidence = [];
  item.description = '';
  item.suggestedFields = { address: '', hours: '' };
  item.images = [];
  item.evidenceCuration = {
    reviewedAt: new Date().toISOString(),
    rejected: true,
    reason
  };
  await writeFile(statePath, `${JSON.stringify(item, null, 2)}\n`);
}

await writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  changes
}, null, 2)}\n`);
process.stdout.write(`正文证据剔除 ${changes.length} 个地点\n${reportPath}\n`);
