import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const archiveDirectory = path.join(root, 'data', 'research', 'xhs-full-2022-2026-08-02');
const stateDirectory = path.join(archiveDirectory, 'places');
const outputPath = path.join(archiveDirectory, 'summary-current.json');
const files = (await readdir(stateDirectory)).filter((name) => name.endsWith('.json')).sort();
const records = [];

for (const file of files) {
  const state = JSON.parse(await readFile(path.join(stateDirectory, file), 'utf8'));
  records.push({
    id: state.place?.id || file.replace(/\.json$/, ''),
    name: state.place?.name || '',
    category: state.place?.category || '',
    status: state.status || 'unknown',
    checkedAt: state.checkedAt || '',
    evidenceCount: state.evidence?.length || 0,
    imageCount: state.images?.length || 0,
    error: state.error || ''
  });
}

const count = (status) => records.filter((record) => record.status === status).length;
const payload = {
  generatedAt: new Date().toISOString(),
  archivedPlaceCount: records.length,
  verified: count('verified'),
  noRecentBodyEvidence: count('no_recent_body_evidence'),
  errors: count('error'),
  unknown: count('unknown'),
  imageCount: records.reduce((sum, record) => sum + record.imageCount, 0),
  records
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, ...payload, records: undefined })}\n`);
