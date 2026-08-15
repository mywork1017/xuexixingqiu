import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const outputDirectory = path.resolve(
  projectRoot,
  process.env.XHS_DISCOVERY_OUTPUT_DIR || 'data/research/xhs-discovery-2022-2026-08-08'
);
const queryDirectory = path.join(outputDirectory, 'queries');
const noteDirectory = path.join(outputDirectory, 'notes');
const candidatesPath = path.join(outputDirectory, 'candidates.json');
const cutoffTime = Date.parse('2022-01-01T00:00:00+08:00');
const xhsPython = process.env.XHS_PYTHON
  || '/Users/tongwang/.local/share/uv/tools/xhs-cli/bin/python';
const requestedLimit = Math.max(0, Number(process.env.XHS_DISCOVERY_LIMIT || 0));
const batchSize = Math.max(0, Number(process.env.XHS_DISCOVERY_BATCH_SIZE || 0));
const intervalMinMs = Math.max(0, Number(process.env.XHS_INTERVAL_MS || 10_000));
const intervalMaxMs = Math.max(
  intervalMinMs,
  Number(process.env.XHS_INTERVAL_MAX_MS || 18_000)
);
const districts = [
  '浦东新区', '黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区',
  '闵行区', '宝山区', '嘉定区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'
];
const queryTemplates = [
  { category: '图书馆', suffix: '图书馆 自习' },
  { category: '图书馆', suffix: '党群 图书馆' },
  { category: '图书馆', suffix: '文化中心 图书馆' },
  { category: '图书馆', suffix: '街道 图书馆' },
  { category: '图书馆', suffix: '社区 图书馆' },
  { category: '食堂', suffix: '社区食堂' },
  { category: '食堂', suffix: '长者食堂' },
  { category: '食堂', suffix: '老年助餐' },
  { category: '食堂', suffix: '助餐点' },
  { category: '食堂', suffix: '老年食堂' }
];
const allQueries = districts.flatMap((district) => (
  queryTemplates.map((item) => ({
    ...item,
    district,
    query: `${district} ${item.suffix}`
  }))
));
const queries = requestedLimit ? allQueries.slice(0, requestedLimit) : allQueries;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[（）()【】[\]]/g, '')
    .replace(/上海市?|区|县|社区|街道|乡|镇|党群服务中心|文化活动中心|文化中心|服务中心|图书馆|分馆|馆|长者|老年|食堂|助餐点/g, '')
    .replace(/[·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

function normalizeAddress(value) {
  return cleanText(value)
    .replace(/^上海市?/, '')
    .replace(/[（）()，,。.、:：;；/\\_\-—]/g, '')
    .replace(/[一二三四五六七八九十\d]+楼.*$/, '');
}

function extractDistrict(value) {
  return cleanText(value).match(new RegExp(districts.join('|')))?.[0] || '';
}

function extractRoadNumber(value) {
  return normalizeAddress(value)
    .match(/([^区县\d]{1,30}(?:公路|大道|路|街|道|弄|巷|村))(\d+)(?:弄(\d+))?号?/)?.slice(1).filter(Boolean).join('') || '';
}

function getRows(payload) {
  return Array.isArray(payload)
    ? payload.filter((row) => /^[a-f0-9]{24}$/i.test(String(row?.id || '')))
    : [];
}

function getTitle(row) {
  return String(row?.noteCard?.displayTitle || row?.note?.title || '').trim();
}

function getToken(row) {
  return String(row?.xsecToken || row?.noteCard?.xsecToken || row?.noteCard?.user?.xsecToken || '');
}

function titleEligible(category, title) {
  if (category === '图书馆') {
    return /图书馆/.test(title)
      && !/(书店|城市书房|流动图书|图书室|借阅点|自习室|大学|学院|学校|校区)/.test(title);
  }
  return /(社区.{0,8}食堂|长者食堂|老年食堂|助餐)/.test(title)
    && !/(自选大食堂|自助大食堂|大学|学院|学校|公司|企业)/.test(title);
}

function bodyEligible(category, text) {
  if (category === '图书馆') {
    return /图书馆/.test(text)
      && /(自习|学习|阅览|阅读|座位|书桌|插座|安静|对外开放|免费开放)/.test(text)
      && !/(流动图书|图书室|借阅点|漂流书|书店|城市书房|付费自习室|校内|内部开放|仅限职工)/.test(text);
  }
  return /(社区.{0,10}食堂|长者食堂|老年食堂|助餐点|助餐服务)/.test(text)
    && !/(内部食堂|职工食堂|学校食堂|公司食堂|自选大食堂|自助大食堂)/.test(text);
}

function extractAddress(text, district) {
  const labeled = text.match(/(?:地址|地点|位置)\s*[：:]\s*([^\n；;。]{5,100})/)?.[1]?.trim() || '';
  const inline = text.match(new RegExp(`(上海市?${district}[^\\n；;。]{2,80}(?:号|弄|村))`))?.[1]?.trim() || '';
  const value = labeled || inline;
  if (!value || !extractRoadNumber(value)) return '';
  if (extractDistrict(value) && extractDistrict(value) !== district) return '';
  return value.startsWith('上海') ? value : `上海市${district}${value.replace(new RegExp(`^${district}`), '')}`;
}

function cleanCandidateName(value) {
  return String(value || '')
    .replace(/^[《【「]|[》】」]$/g, '')
    .replace(/^(探店|打卡|上海|寻找\d+家|推荐)[｜|：:\s-]*/g, '')
    .replace(/[｜|：:#].*$/g, '')
    .trim();
}

function extractName(category, title, body) {
  const ending = category === '图书馆' ? '图书馆' : '(?:社区食堂|长者食堂|老年食堂|助餐点)';
  const source = `${title}\n${body}`;
  const matches = [...source.matchAll(new RegExp(`([^\\n，。；;#]{2,36}${ending})`, 'g'))]
    .map((match) => cleanCandidateName(match[1]))
    .filter((name) => name.length <= 40);
  const titleName = cleanCandidateName(title);
  if (new RegExp(`${ending}$`).test(titleName)) matches.unshift(titleName);
  return matches.sort((left, right) => left.length - right.length)[0] || '';
}

function extractFields(body) {
  const hours = body.match(/(?:开放时间|营业时间)\s*[：:]\s*([^\n。]{4,120})/)?.[1]?.trim() || '';
  return { hours };
}

function synthesizeDescription(body) {
  const clauses = [];
  if (/热水|开水/.test(body)) clauses.push(/无热水|没有热水|不提供热水/.test(body) ? '不提供热水' : '提供热水');
  else if (/饮水机|饮水处|茶水/.test(body)) clauses.push('提供饮水');
  if (/厕所|卫生间|洗手间/.test(body)) clauses.push(/无厕所|没有厕所|不设厕所/.test(body) ? '不设厕所' : '设有厕所');
  if (/插座|电源|充电口/.test(body)) clauses.push(/无插座|没有插座|不提供插座/.test(body) ? '不提供电源插座' : '设有电源插座');
  if (/wifi|wi-fi|无线网络/i.test(body)) clauses.push(/无\s*(?:wifi|wi-fi)|没有\s*(?:wifi|wi-fi)/i.test(body) ? '不提供 Wi-Fi' : '提供 Wi-Fi');
  if (/安静/.test(body)) clauses.push('环境安静');
  else if (/嘈杂|吵闹|很吵/.test(body)) clauses.push('环境较嘈杂');
  if (/宽敞|空间大/.test(body)) clauses.push('空间宽敞');
  if (/采光好|采光充足|明亮/.test(body)) clauses.push('采光明亮');
  if (/座位多|座位充足|座位够用/.test(body)) clauses.push('座位较充足');
  else if (/座位少|座位有限|座位紧张/.test(body)) clauses.push('座位有限');
  if (/环境整洁|环境干净|干净整洁/.test(body)) clauses.push('环境整洁');
  return clauses.length ? `${[...new Set(clauses)].join('，')}。` : '';
}

let requestId = 0;
let lastRequestAt = 0;
const pending = new Map();
const bridge = spawn(xhsPython, [path.join(projectRoot, 'scripts', 'xhs-batch-bridge.py')], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe']
});
const lines = readline.createInterface({ input: bridge.stdout });
lines.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.data);
    else request.reject(new Error(response.error || 'xhs-cli bridge failed'));
  } catch {
    // Browser diagnostics are written separately.
  }
});
bridge.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function runBridge(payload) {
  const intervalMs = intervalMinMs + Math.floor(Math.random() * (intervalMaxMs - intervalMinMs + 1));
  const wait = Math.max(0, intervalMs - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const id = ++requestId;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('xhs-cli request timed out'));
    }, 120_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
    bridge.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
  });
  lastRequestAt = Date.now();
  return result;
}

async function readNote(row) {
  const notePath = path.join(noteDirectory, `${row.id}.json`);
  try {
    return JSON.parse(await readFile(notePath, 'utf8'));
  } catch {
    const detail = await runBridge({
      operation: 'read',
      noteId: String(row.id),
      xsecToken: getToken(row)
    });
    await writeFile(notePath, `${JSON.stringify(detail, null, 2)}\n`);
    return detail;
  }
}

async function collectQuery(item) {
  const slug = `${item.district}-${item.category}-${item.query.replace(/\s+/g, '-')}`;
  const statePath = path.join(queryDirectory, `${slug}.json`);
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8'));
    if (previous.status === 'completed') return previous;
  } catch {
    // First run.
  }
  const result = { ...item, status: 'completed', checkedAt: new Date().toISOString(), notes: [] };
  try {
    const rows = getRows(await runBridge({ operation: 'search', query: item.query }))
      .filter((row) => titleEligible(item.category, getTitle(row)))
      .slice(0, 4);
    for (const row of rows) {
      try {
        const detail = await readNote(row);
        const note = detail.note || {};
        const publishedAt = Number(note.time) || 0;
        const body = String(note.desc || '').trim();
        const title = String(note.title || getTitle(row)).trim();
        const text = `${title}\n${body}`;
        if (publishedAt < cutoffTime || !bodyEligible(item.category, text)) continue;
        const address = extractAddress(text, item.district);
        const name = extractName(item.category, title, body);
        if (!name || !address) continue;
        result.notes.push({
          noteId: String(note.noteId || row.id),
          title,
          body,
          publishedAt: new Date(publishedAt).toISOString(),
          name,
          category: item.category,
          address,
          ...extractFields(body),
          description: synthesizeDescription(body),
          images: (note.imageList || []).map((image) => ({
            url: String(image.urlDefault || image.url || ''),
            width: Number(image.width) || 0,
            height: Number(image.height) || 0
          })).filter((image) => image.url)
        });
      } catch {
        // Continue with next search result.
      }
    }
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
  }
  await writeFile(statePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function readCompletedQuery(item) {
  const slug = `${item.district}-${item.category}-${item.query.replace(/\s+/g, '-')}`;
  const statePath = path.join(queryDirectory, `${slug}.json`);
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8'));
    return previous.status === 'completed' ? previous : null;
  } catch {
    return null;
  }
}

async function readAllQueryResults() {
  const names = (await readdir(queryDirectory)).filter((name) => name.endsWith('.json'));
  const results = [];
  for (const name of names) {
    try {
      results.push(JSON.parse(await readFile(path.join(queryDirectory, name), 'utf8')));
    } catch {
      // Ignore incomplete state files; the next batch will retry them.
    }
  }
  return results;
}

await Promise.all([
  mkdir(queryDirectory, { recursive: true }),
  mkdir(noteDirectory, { recursive: true })
]);
let queryResults = [];
let attemptedQueries = 0;
for (let index = 0; index < queries.length; index += 1) {
  const cached = await readCompletedQuery(queries[index]);
  if (cached) continue;
  if (batchSize && attemptedQueries >= batchSize) break;
  const result = await collectQuery(queries[index]);
  attemptedQueries += 1;
  process.stdout.write(`本批 ${attemptedQueries}/${batchSize || queries.length}：${queries[index].query} [${result.status}] 候选 ${result.notes.length}\n`);
}
queryResults = await readAllQueryResults();

const { stdout } = await execFileAsync('sqlite3', [
  '-readonly',
  '-json',
  path.join(projectRoot, 'admin', 'prisma', 'dev.db'),
  `SELECT id, name, category, address FROM Place WHERE category IN ('图书馆', '食堂')`
]);
const existing = JSON.parse(stdout);
const aggregated = new Map();
for (const note of queryResults.flatMap((result) => result.notes)) {
  const key = `${note.category}:${normalizeName(note.name)}:${extractRoadNumber(note.address)}`;
  const current = aggregated.get(key);
  if (!current || Date.parse(note.publishedAt) > Date.parse(current.publishedAt)) {
    aggregated.set(key, note);
  }
}
const candidates = [...aggregated.values()].map((candidate) => {
  const duplicate = existing.find((place) => {
    if (place.category !== candidate.category) return false;
    const sameRoad = extractRoadNumber(place.address)
      && extractRoadNumber(place.address) === extractRoadNumber(candidate.address);
    const left = normalizeName(place.name);
    const right = normalizeName(candidate.name);
    const sameName = left && right && (left === right || left.includes(right) || right.includes(left));
    return sameRoad || (sameName && extractDistrict(place.address) === extractDistrict(candidate.address));
  });
  return {
    ...candidate,
    status: duplicate ? 'possible_duplicate' : 'new_candidate',
    duplicate: duplicate || null
  };
}).sort((left, right) => (
  left.status.localeCompare(right.status)
  || left.category.localeCompare(right.category)
  || left.name.localeCompare(right.name, 'zh-CN')
));
await writeFile(candidatesPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourcePolicy: 'xhs-cli 正文与正文配图；未读取评论；2022-01-01 以后内容',
  queryCount: allQueries.length,
  attemptedQueries,
  completedQueries: queryResults.filter((item) => item.status === 'completed').length,
  errorQueries: queryResults.filter((item) => item.status === 'error').length,
  newCandidates: candidates.filter((item) => item.status === 'new_candidate').length,
  possibleDuplicates: candidates.filter((item) => item.status === 'possible_duplicate').length,
  candidates
}, null, 2)}\n`);
process.stdout.write(`${candidatesPath}\n`);
bridge.stdin.end();
