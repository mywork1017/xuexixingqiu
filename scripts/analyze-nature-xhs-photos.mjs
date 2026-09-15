#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const qaDirectory = path.resolve(process.argv[2] || 'data/research/nature-xhs-photos-2026-09-12/qa-selected');
const manifest = JSON.parse(await readFile(path.join(qaDirectory, 'manifest.json'), 'utf8'));
const paths = manifest.candidates.map((candidate) => candidate.sourcePath);
const result = spawnSync('swift', [path.join(projectRoot, 'scripts', 'analyze-place-photo-vision.swift'), ...paths], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024
});
if (result.status !== 0) throw new Error(result.stderr || `Vision exited ${result.status}`);
const analyses = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const byPath = new Map(analyses.map((analysis) => [analysis.path, analysis]));
const records = manifest.candidates.map((candidate) => ({ ...candidate, analysis: byPath.get(candidate.sourcePath) || null }));
await writeFile(path.join(qaDirectory, 'vision-analysis.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  records
}, null, 2)}\n`);
console.log(JSON.stringify({ requested: paths.length, analyzed: analyses.length, errors: analyses.filter((item) => item.error).length }, null, 2));
