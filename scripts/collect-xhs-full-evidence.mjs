import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import readline from 'node:readline';

const execFileAsync = promisify(execFile);
const require = createRequire(new URL('../admin/package.json', import.meta.url));
const sharp = require('sharp');
const projectRoot = process.cwd();
const runDate = '2026-08-02';
const outputDirectory = path.join(projectRoot, 'data', 'research', `xhs-full-2022-${runDate}`);
const stateDirectory = path.join(outputDirectory, 'places');
const rawDirectory = path.join(outputDirectory, 'raw');
const uploadDirectory = path.join(projectRoot, 'admin', 'public', 'uploads', 'xhs-full');
const summaryPath = path.join(outputDirectory, 'summary.json');
const cutoffTime = Date.parse('2022-01-01T00:00:00+08:00');
const xhsPython = process.env.XHS_PYTHON
  || '/Users/tongwang/.local/share/uv/tools/xhs-cli/bin/python';
const concurrency = Math.max(1, Number(process.env.XHS_CONCURRENCY || 1));
const requestedLimit = Number(process.env.XHS_LIMIT || 0);
const collectorVersion = 3;
const minCommandIntervalMs = Math.max(0, Number(process.env.XHS_INTERVAL_MS || 2500));
let lastCommandFinishedAt = 0;
let bridgeRequestId = 0;
const bridgeRequests = new Map();
const xhsBridge = spawn(xhsPython, [path.join(projectRoot, 'scripts', 'xhs-batch-bridge.py')], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe']
});
const bridgeLines = readline.createInterface({ input: xhsBridge.stdout });
bridgeLines.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    const pending = bridgeRequests.get(response.id);
    if (!pending) return;
    bridgeRequests.delete(response.id);
    if (response.ok) pending.resolve(response.data);
    else pending.reject(new Error(response.error || 'xhs-cli bridge failed'));
  } catch {
    // Ignore non-JSON diagnostic lines from the browser client.
  }
});
xhsBridge.stderr.on('data', (chunk) => process.stderr.write(chunk));
xhsBridge.on('exit', (code) => {
  for (const pending of bridgeRequests.values()) {
    pending.reject(new Error(`xhs-cli bridge exited with code ${code}`));
  }
  bridgeRequests.clear();
});

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

function compactName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[（）()【】[\]·•,，.。:：;；/\\_\-—&“”"'’]/g, '');
}

function extractDistrict(value) {
  return cleanText(value).match(/浦东新区|黄浦区|徐汇区|长宁区|静安区|普陀区|虹口区|杨浦区|闵行区|宝山区|嘉定区|金山区|松江区|青浦区|奉贤区|崇明区/)?.[0] || '';
}

function extractRoadNumber(value) {
  return cleanText(value)
    .replace(/^上海市?/, '')
    .match(/([^区县,，。；;]{1,30}(?:公路|大道|路|街|道|弄|巷|村))(\d+)(?:弄(\d+))?号?/)?.slice(1).filter(Boolean).join('') || '';
}

function getRows(payload) {
  return Array.isArray(payload)
    ? payload.filter((row) => /^[a-f0-9]{24}$/i.test(String(row?.id || '')))
    : [];
}

function getPublishTime(payload) {
  const value = Number(payload?.note?.time);
  return Number.isFinite(value) ? value : 0;
}

function getToken(row) {
  return String(row?.xsecToken || row?.noteCard?.xsecToken || row?.noteCard?.user?.xsecToken || '');
}

function getTitle(row) {
  return String(row?.noteCard?.displayTitle || row?.note?.title || '').trim();
}

function rankSearchResult(place, row) {
  const title = getTitle(row);
  const left = normalizeName(place.name);
  const right = normalizeName(title);
  let score = 0;
  if (title.includes(place.name)) score += 120;
  if (left && right && left === right) score += 100;
  if (Math.min(left.length, right.length) >= 3 && (left.includes(right) || right.includes(left))) score += 70;
  if (place.category === '图书馆' && /图书馆|阅读空间/.test(title)) score += 15;
  if (place.category === '食堂' && /食堂|助餐/.test(title)) score += 15;
  return score;
}

function scoreBodyMatch(place, note) {
  const title = String(note?.title || '');
  const body = String(note?.desc || '');
  const fullText = `${title}\n${body}`;
  const placeName = compactName(place.name);
  const compactText = compactName(fullText);
  const normalizedPlace = normalizeName(place.name);
  const normalizedText = normalizeName(fullText);
  const roadNumber = extractRoadNumber(place.address);
  const district = extractDistrict(place.address);
  const mentionedDistricts = [...fullText.matchAll(/浦东新区|黄浦区|徐汇区|长宁区|静安区|普陀区|虹口区|杨浦区|闵行区|宝山区|嘉定区|金山区|松江区|青浦区|奉贤区|崇明区/g)]
    .map((match) => match[0]);
  let score = 0;
  const reasons = [];

  if (placeName && compactText.includes(placeName)) {
    score += 120;
    reasons.push('完整名称');
  }
  if (
    normalizedPlace.length >= 3
    && normalizedText.includes(normalizedPlace)
  ) {
    score += 80;
    reasons.push('规范化名称');
  }
  if (roadNumber && cleanText(fullText).includes(roadNumber)) {
    score += 120;
    reasons.push('门牌');
  }
  if (district && mentionedDistricts.includes(district)) {
    score += 15;
    reasons.push('行政区');
  }
  const wrongDistrict = mentionedDistricts.length > 0 && district && !mentionedDistricts.includes(district);
  if (wrongDistrict && !reasons.includes('完整名称') && !reasons.includes('门牌')) score -= 100;

  return {
    accepted: Boolean(body.trim()) && score >= 80,
    score,
    reasons,
    roadNumber,
    mentionedDistricts: [...new Set(mentionedDistricts)]
  };
}

function synthesizeDescription(bodies) {
  const source = bodies.join('\n');
  const clauses = [];
  if (/无热水|没有热水|不提供热水/.test(source)) clauses.push('不提供热水');
  else if (/热水|开水/.test(source)) clauses.push('提供热水');
  else if (/饮水机|饮水处|提供饮水|茶水/.test(source)) clauses.push('提供饮水');

  if (/无厕所|没有厕所|不设厕所|不提供卫生间/.test(source)) clauses.push('不设厕所');
  else if (/厕所|卫生间|洗手间|蹲厕|坐厕|马桶/.test(source)) {
    if (/(厕所|卫生间|洗手间).{0,10}(干净|整洁|无异味)|(干净|整洁|无异味).{0,10}(厕所|卫生间|洗手间)/.test(source)) {
      clauses.push('厕所整洁');
    } else {
      clauses.push('设有厕所');
    }
  }

  if (/无插座|没有插座|不提供插座/.test(source)) clauses.push('不提供电源插座');
  else if (/插座少|插座有限|少量插座|部分.{0,6}插座/.test(source)) clauses.push('电源插座数量有限');
  else if (/插座|电源|充电口/.test(source)) clauses.push('设有电源插座');

  if (/无\s*(?:wifi|wi-fi)|没有\s*(?:wifi|wi-fi)|不提供\s*(?:wifi|wi-fi)/i.test(source)) clauses.push('不提供 Wi-Fi');
  else if (/wifi|wi-fi|无线网络/i.test(source)) clauses.push('提供 Wi-Fi');

  if (/很安静|比较安静|环境安静|安静.{0,5}(学习|看书|阅读|自习)/.test(source)) clauses.push('环境安静');
  else if (/嘈杂|吵闹|很吵/.test(source)) clauses.push('环境较嘈杂');
  if (/宽敞|空间大|面积很大/.test(source)) clauses.push('空间宽敞');
  else if (/空间小|面积小|地方小|不大/.test(source)) clauses.push('空间较小');
  if (/采光好|采光充足|光线明亮|明亮/.test(source)) clauses.push('采光明亮');
  if (/座位多|座位充足|座位够用/.test(source)) clauses.push('座位较充足');
  else if (/座位少|座位有限|座位紧张/.test(source)) clauses.push('座位有限');
  if (/环境整洁|环境干净|用餐区.{0,6}(整洁|干净)|干净整洁/.test(source)) clauses.push('环境整洁');
  else if (/舒适|舒服/.test(source)) clauses.push('环境舒适');
  if (/拥挤|人很多|人多.{0,5}(座位|排队)/.test(source)) clauses.push('高峰时段可能拥挤');

  return clauses.length ? `${[...new Set(clauses)].join('，')}。` : '';
}

function extractSuggestedFields(bodies) {
  const source = bodies.join('\n');
  const address = source.match(/(?:地址|地点|位置)\s*[：:]\s*([^\n；;。]{5,80})/)?.[1]?.trim() || '';
  const hours = source.match(/(?:开放时间|营业时间)\s*[：:]\s*([^\n。]{4,120})/)?.[1]?.trim() || '';
  return { address, hours };
}

async function runXhs(args) {
  let lastError;
  const maximumAttempts = args[0] === 'search' ? 2 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const delay = Math.max(0, minCommandIntervalMs - (Date.now() - lastCommandFinishedAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const operation = args[0];
      const id = ++bridgeRequestId;
      const tokenIndex = args.indexOf('--xsec-token');
      const payload = operation === 'search'
        ? { id, operation, query: args[1] }
        : {
          id,
          operation,
          noteId: args[1],
          xsecToken: tokenIndex >= 0 ? args[tokenIndex + 1] : ''
        };
      const data = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          bridgeRequests.delete(id);
          reject(new Error(`xhs-cli ${operation} timed out`));
        }, 120_000);
        bridgeRequests.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
        xhsBridge.stdin.write(`${JSON.stringify(payload)}\n`);
      });
      lastCommandFinishedAt = Date.now();
      return data;
    } catch (error) {
      lastError = error;
      lastCommandFinishedAt = Date.now();
      if (attempt < maximumAttempts) await new Promise((resolve) => setTimeout(resolve, 12_000));
    }
  }
  throw lastError;
}

async function search(query) {
  return getRows(await runXhs(['search', query, '--json']));
}

async function readNote(row) {
  const args = ['read', String(row.id)];
  const token = getToken(row);
  if (token) args.push('--xsec-token', token);
  args.push('--json');
  return runXhs(args);
}

async function download(url) {
  const response = await fetch(url.replace(/^http:/, 'https:'), {
    headers: {
      Referer: 'https://www.xiaohongshu.com/',
      'User-Agent': 'Mozilla/5.0'
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareImages(place, notes) {
  const candidates = notes.flatMap((item) => (
    (item.note.imageList || []).map((image, imageIndex) => ({
      noteId: String(item.note.noteId || ''),
      imageIndex,
      url: String(image.urlDefault || image.url || ''),
      declaredWidth: Number(image.width) || 0,
      declaredHeight: Number(image.height) || 0
    }))
  )).filter((image) => image.url);
  const unique = [...new Map(candidates.map((image) => [image.url, image])).values()].slice(0, 16);
  const downloaded = [];
  const placeRawDirectory = path.join(rawDirectory, place.id);
  await mkdir(placeRawDirectory, { recursive: true });

  for (const candidate of unique) {
    try {
      const buffer = await download(candidate.url);
      const pipeline = sharp(buffer).rotate();
      const [metadata, stats] = await Promise.all([pipeline.metadata(), pipeline.stats()]);
      const width = Number(metadata.width) || candidate.declaredWidth;
      const height = Number(metadata.height) || candidate.declaredHeight;
      const ratio = width && height ? width / height : 0;
      if (Math.min(width, height) < 720 || ratio < 0.45 || ratio > 2.2 || stats.entropy < 2.5) continue;
      const rawPath = path.join(placeRawDirectory, `${candidate.noteId}-${candidate.imageIndex}.source`);
      await writeFile(rawPath, buffer);
      downloaded.push({
        ...candidate,
        width,
        height,
        entropy: Number(stats.entropy.toFixed(3)),
        rawPath,
        qualityScore: Math.min(width, height) + stats.entropy * 100 - (candidate.imageIndex === 0 ? 180 : 0)
      });
    } catch {
      // Failed or low-quality source image is excluded.
    }
  }

  const selected = downloaded
    .sort((left, right) => right.qualityScore - left.qualityScore)
    .slice(0, 3);
  const placeUploadDirectory = path.join(uploadDirectory, place.id);
  await mkdir(placeUploadDirectory, { recursive: true });
  const images = [];
  for (let index = 0; index < selected.length; index += 1) {
    const source = selected[index];
    const filename = `${String(index + 1).padStart(2, '0')}.webp`;
    const finalPath = path.join(placeUploadDirectory, filename);
    await sharp(source.rawPath)
      .rotate()
      .resize(1080, 1080, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toFile(finalPath);
    images.push({
      url: `/uploads/xhs-full/${place.id}/${filename}`,
      noteId: source.noteId,
      sourceImageIndex: source.imageIndex,
      sourceUrl: source.url,
      width: source.width,
      height: source.height,
      entropy: source.entropy
    });
  }
  return images;
}

async function collectPlace(place) {
  const statePath = path.join(stateDirectory, `${place.id}.json`);
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8'));
    if (
      previous.collectorVersion === collectorVersion
      && ['verified', 'no_recent_body_evidence'].includes(previous.status)
    ) return previous;
  } catch {
    // First attempt for this place.
  }

  const district = extractDistrict(place.address);
  const query = `${district} ${place.name}`.trim();
  const result = {
    place: {
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address,
      district
    },
    query,
    collectorVersion,
    status: 'no_recent_body_evidence',
    checkedAt: new Date().toISOString(),
    evidence: [],
    description: '',
    suggestedFields: { address: '', hours: '' },
    images: []
  };

  try {
    const rows = (await search(query))
      .map((row) => ({ row, score: rankSearchResult(place, row) }))
      .filter((item) => item.score >= 40)
      .sort((left, right) => right.score - left.score)
      .slice(0, 1);
    const matchedNotes = [];
    for (const candidate of rows) {
      try {
        const detail = await readNote(candidate.row);
        const publishedAt = getPublishTime(detail);
        if (publishedAt < cutoffTime) continue;
        const match = scoreBodyMatch(place, detail.note);
        if (!match.accepted) continue;
        matchedNotes.push(detail);
        result.evidence.push({
          noteId: String(detail.note.noteId || candidate.row.id),
          title: String(detail.note.title || ''),
          body: String(detail.note.desc || ''),
          publishedAt: new Date(publishedAt).toISOString(),
          match
        });
      } catch {
        // Try next ranked result.
      }
    }
    if (matchedNotes.length) {
      matchedNotes.sort((left, right) => getPublishTime(right) - getPublishTime(left));
      result.evidence.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
      matchedNotes.splice(2);
      result.evidence.splice(2);
      const bodies = matchedNotes.map((item) => String(item.note.desc || ''));
      result.status = 'verified';
      result.description = synthesizeDescription(bodies);
      result.suggestedFields = extractSuggestedFields(bodies);
      result.images = await prepareImages(place, matchedNotes);
    }
  } catch (error) {
    result.status = 'error';
    result.error = [
      error instanceof Error ? error.message : String(error),
      String(error?.stderr || '').trim()
    ].filter(Boolean).join('\n');
  }

  await writeFile(statePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let finished = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
      finished += 1;
      process.stdout.write(
        `完成 ${finished}/${items.length}：${items[index].name} [${results[index].status}] 图 ${results[index].images?.length || 0}\n`
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

await Promise.all([
  mkdir(stateDirectory, { recursive: true }),
  mkdir(rawDirectory, { recursive: true }),
  mkdir(uploadDirectory, { recursive: true })
]);
const sql = `
  SELECT id, name, category, address
  FROM Place
  WHERE category IN ('图书馆', '食堂')
  ORDER BY category, name
`;
const { stdout } = await execFileAsync('sqlite3', [
  '-readonly',
  '-json',
  path.join(projectRoot, 'admin', 'prisma', 'dev.db'),
  sql
]);
const allPlaces = JSON.parse(stdout);
const places = requestedLimit > 0 ? allPlaces.slice(0, requestedLimit) : allPlaces;
const results = await mapConcurrent(places, collectPlace);
const summary = {
  generatedAt: new Date().toISOString(),
  cutoffDate: '2022-01-01',
  sourcePolicy: 'xhs-cli 正文与正文配图；未读取评论',
  total: results.length,
  verified: results.filter((item) => item.status === 'verified').length,
  noRecentBodyEvidence: results.filter((item) => item.status === 'no_recent_body_evidence').length,
  errors: results.filter((item) => item.status === 'error').length,
  withDescriptions: results.filter((item) => item.description).length,
  withImages: results.filter((item) => item.images?.length).length,
  imageCount: results.reduce((sum, item) => sum + (item.images?.length || 0), 0),
  results: results.map((item) => ({
    id: item.place.id,
    name: item.place.name,
    category: item.place.category,
    status: item.status,
    evidenceCount: item.evidence?.length || 0,
    imageCount: item.images?.length || 0,
    hasDescription: Boolean(item.description),
    error: item.error || ''
  }))
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${summaryPath}\n`);
xhsBridge.stdin.end();
