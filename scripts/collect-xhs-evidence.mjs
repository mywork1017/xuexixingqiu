import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const outputDirectory = path.join(projectRoot, 'data', 'research', 'xhs-xuhui-huangpu');
const outputPath = path.join(outputDirectory, 'evidence.json');
const cutoffTime = Date.parse('2024-08-02T00:00:00+08:00');
const xhsCommand = process.env.XHS_COMMAND || 'xhs';
const concurrency = 3;

const discoveryQueries = [
  {
    query: '徐汇区 社区食堂',
    noteIds: [
      '66de89a3000000002603f563',
      '68b1af6b000000001d02b3b8',
      '6919775a000000000503b053',
      '6981e8c1000000002103fc37',
      '69f8821e00000000200386e2'
    ]
  },
  {
    query: '徐汇区 长者食堂',
    noteIds: [
      '68575b780000000012030e2b',
      '67ebe349000000000b01cb8f',
      '69ff36390000000036019643'
    ]
  },
  {
    query: '天平里 食堂',
    noteIds: [
      '69314217000000001e0025f1',
      '698ec214000000001b01d895',
      '67304d4b000000001901aa5b',
      '67c1a1be0000000029010673'
    ]
  },
  {
    query: '徐汇区 图书馆',
    noteIds: [
      '67c000480000000003029984',
      '690caecb000000000402be5d',
      '695947b0000000001d03a8a'
    ]
  },
  {
    query: '黄浦区 社区食堂',
    noteIds: [
      '674ae043000000000703652d',
      '691e8b71000000001e02bde5',
      '69a54e9d000000001a02043c',
      '6821fc520000000022006f8e'
    ]
  },
  {
    query: '黄浦区 长者食堂',
    noteIds: [
      '6767deff000000000800e71e',
      '6899f1eb0000000023025b36',
      '694fbaef00000000220395bd'
    ]
  },
  {
    query: '黄浦区 党群 图书馆',
    noteIds: [
      '6a54f9d8000000000f017e59',
      '6a4a5846000000000f02af3a',
      '6a4e50b4000000000f030cb6',
      '6a1777f100000000350382bd',
      '6a3c5bab000000001102db61',
      '6a6bda4e00000000250010df'
    ]
  }
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/上海市?|徐汇区|黄浦区|社区|街道|图书馆|长者|老年|食堂|分馆|总馆/g, '')
    .replace(/[\s·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

function getSearchRows(payload) {
  return Array.isArray(payload)
    ? payload.filter((row) => /^[a-f0-9]{24}$/i.test(String(row?.id || '')))
    : [];
}

function getPublishTime(row) {
  const value = row?.note?.time;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function toEvidence(row, context) {
  const note = row.note;
  return {
    ...context,
    noteId: String(note.noteId || ''),
    title: String(note.title || '').trim(),
    body: String(note.desc || '').trim(),
    publishedAt: new Date(getPublishTime(row)).toISOString(),
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

async function search(query) {
  return getSearchRows(await runXhs(['search', query, '--json']));
}

async function readNote(row) {
  const token = String(row.xsecToken || row.noteCard?.user?.xsecToken || '');
  const args = ['read', String(row.id)];
  if (token) args.push('--xsec-token', token);
  args.push('--json');
  return runXhs(args);
}

function rankTargetCandidate(target, row) {
  const title = String(row?.noteCard?.displayTitle || '');
  const normalizedName = normalizeText(target.name);
  const normalizedTitle = normalizeText(title);
  let score = 0;
  if (title.includes(target.name)) score += 100;
  if (normalizedName && normalizedTitle.includes(normalizedName)) score += 70;
  if (normalizedTitle && normalizedName.includes(normalizedTitle)) score += 40;
  if (target.category === '图书馆' && /图书馆|书院/.test(title)) score += 10;
  if (target.category === '食堂' && /食堂|助餐/.test(title)) score += 10;
  return score;
}

async function collectTargetEvidence(target) {
  const district = target.address.includes('徐汇区') ? '徐汇区' : '黄浦区';
  const query = `${district} ${target.name}`;
  const rows = await search(query);
  const candidates = rows
    .map((row) => ({ row, score: rankTargetCandidate(target, row) }))
    .filter((item) => item.score >= 10)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  for (const candidate of candidates) {
    try {
      const detail = await readNote(candidate.row);
      if (getPublishTime(detail) < cutoffTime) continue;
      return {
        status: 'verified',
        evidence: toEvidence(detail, {
          kind: 'existing',
          query,
          targetId: target.id,
          targetName: target.name,
          targetCategory: target.category,
          district
        })
      };
    } catch {
      continue;
    }
  }

  return {
    status: 'no_recent_body_evidence',
    evidence: {
      kind: 'existing',
      query,
      targetId: target.id,
      targetName: target.name,
      targetCategory: target.category,
      district
    }
  };
}

async function collectDiscoveryEvidence(item) {
  const rows = await search(item.query);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const collected = [];

  for (const noteId of item.noteIds) {
    const row = byId.get(noteId);
    if (!row) continue;
    try {
      const detail = await readNote(row);
      if (getPublishTime(detail) < cutoffTime) continue;
      collected.push(toEvidence(detail, {
        kind: 'discovery',
        query: item.query,
        district: item.query.startsWith('徐汇') || item.query.startsWith('天平') ? '徐汇区' : '黄浦区'
      }));
    } catch {
      continue;
    }
  }

  return collected;
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        results[index] = {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
      }
      process.stdout.write(`完成 ${index + 1}/${items.length}\n`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const sql = `
  SELECT id, name, category, address
  FROM Place
  WHERE address LIKE '%徐汇区%' OR address LIKE '%黄浦区%'
  ORDER BY address, category, name
`;
const { stdout: placesJson } = await execFileAsync('sqlite3', [
  '-readonly',
  '-json',
  path.join(projectRoot, 'admin', 'prisma', 'dev.db'),
  sql
]);
const targets = JSON.parse(placesJson);

const targetResults = await mapConcurrent(targets, collectTargetEvidence);
const discoveryResults = await mapConcurrent(discoveryQueries, collectDiscoveryEvidence);
const evidence = {
  generatedAt: new Date().toISOString(),
  cutoffDate: '2024-08-02',
  districts: ['徐汇区', '黄浦区'],
  sourcePolicy: 'xhs-cli read body only; comments excluded',
  existing: targetResults,
  discovery: discoveryResults.flat().filter(Boolean)
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);
