#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';

const require = createRequire(new URL('../admin/package.json', import.meta.url));
const sharp = require('sharp');

const root = process.cwd();
const database = process.env.DATABASE || 'admin/prisma/dev.db';
const researchDir = path.resolve(process.env.RESEARCH_DIR || 'data/research/suzhou-photo-refresh-2026-08-16/xhs');
const maxNotes = Number(process.env.MAX_NOTES || 4);
const maxImagesPerNote = Number(process.env.MAX_IMAGES_PER_NOTE || 10);
const minShortSide = Number(process.env.MIN_SHORT_SIDE || 1000);
const xhsPython = process.env.XHS_PYTHON || '/Users/tongwang/.local/share/uv/tools/xhs-cli/bin/python';
const queryMode = process.env.QUERY_MODE || 'name';
const queryOverride = process.env.QUERY_OVERRIDE || '';
const city = process.env.CITY || '苏州';
const category = process.env.CATEGORY || '';
const offset = Number(process.env.OFFSET || 0);
const limit = Number(process.env.LIMIT || 0);
const photolessOnly = process.env.PHOTOLESS_ONLY === '1';

function normalize(value = '') {
  return value
    .toLowerCase()
    .replace(/[\s·•（）()“”'"《》—–\-_/，,。.：:；;]+/g, '');
}

function branchName(name) {
  const match = name.match(/[（(]([^）)]+)[）)]/);
  if (match) return match[1].replace(/分馆.*$/, '').replace(/苏州书房/g, '').trim();
  return name.replace(/^苏州书房[·・]/, '').replace(/^苏州图书馆/, '').replace(/分馆.*$/, '').trim();
}

function natureBaseName(name) {
  return String(name || '').replace(/[（(].*?[）)]/g, '').replace(/[一二三四五六七八九十]+期$/g, '').replace(/^新区/, '').trim();
}

function regionTerm(address) {
  return String(address || '').match(/([^市]{2,8}(?:区|县)|[^省市]{2,8}市)(?=[^市]|$)/)?.[1]?.replace(/^.*市/, '') || city;
}

function addressTerms(address) {
  return [...address.matchAll(/([\u4e00-\u9fff]{2,12}(?:路|街|巷|弄|社区|花园|中心|书院|饭店))/g)]
    .map((match) => match[1])
    .filter((value) => ![`${city}市`, '服务中心', '社区服务中心', '市民活动中心'].includes(value))
    .slice(-3);
}

function placeScore(place, text) {
  const haystack = normalize(text);
  const exact = normalize(place.name);
  const branch = normalize(place.category === '自然' ? natureBaseName(place.name) : branchName(place.name));
  let score = haystack.includes(exact) ? 30 : 0;
  if (branch.length >= 2 && haystack.includes(branch)) score += 24;
  if (haystack.includes(normalize(city))) score += 3;
  for (const term of addressTerms(place.address)) {
    if (haystack.includes(normalize(term))) score += 8;
  }
  if (place.category === '图书馆' && haystack.includes('图书馆')) score += 3;
  if (place.category === '食堂' && /(食堂|助餐|小厨)/.test(haystack)) score += 3;
  if (place.category === '自然' && /(公园|绿地|滨水|风景|湿地|绿道|步道)/.test(haystack)) score += 3;
  return score;
}

function isIdentityMatch(place, text, requireNatureRegion = false) {
  const haystack = normalize(text);
  if (place.name === '苏州图书馆') {
    return !/(北馆|第二图书馆)/.test(text)
      && (haystack.includes('人民路馆') || haystack.includes('人民路858号') || haystack.includes('苏州图书馆总馆'));
  }
  const exact = normalize(place.name);
  const branch = normalize(place.category === '自然' ? natureBaseName(place.name) : branchName(place.name));
  const natureRegionMatched = place.category !== '自然'
    || haystack.includes(normalize(regionTerm(place.address)))
    || haystack.includes(normalize(city))
    || addressTerms(place.address).some((term) => haystack.includes(normalize(term)));
  if (haystack.includes(exact)) return !requireNatureRegion || natureRegionMatched;
  if (branch.length >= 3 && haystack.includes(branch)) {
    if (place.category !== '自然') return true;
    return natureRegionMatched;
  }
  const matchedAddressTerms = addressTerms(place.address).filter((term) => haystack.includes(normalize(term)));
  return matchedAddressTerms.length >= 1 && haystack.includes(normalize(place.category));
}

function queryFor(place) {
  if (queryOverride) return queryOverride;
  if (queryMode === 'landmark') {
    const landmark = addressTerms(place.address).at(-1) || place.address.replace(/^苏州市?/, '').slice(0, 16);
    const short = branchName(place.name) || place.name;
    return `${city} ${short} ${landmark} ${place.category}`;
  }
  if (city === '苏州' && place.name === '苏州图书馆') return '苏州图书馆 人民路馆';
  const short = branchName(place.name);
  if (place.category === '图书馆') {
    return city === '苏州' && short ? `苏州图书馆 ${short}分馆` : `${city} ${place.name}`;
  }
  if (place.category === '自然') return `${regionTerm(place.address)} ${natureBaseName(place.name)} 公园风景`;
  return `${city} ${place.name}`;
}

function loadPlaces() {
  const cityPrefixes = city === '苏州' ? ['苏州市', '苏州高新区'] : [`${city}市`];
  const conditions = [`(${cityPrefixes.map((prefix) => `p.address LIKE '${prefix.replaceAll("'", "''")}%'`).join(' OR ')})`];
  if (category) conditions.push(`p.category = '${category.replaceAll("'", "''")}'`);
  const having = photolessOnly ? ' HAVING COUNT(ph.id) = 0' : '';
  const pagination = `${limit > 0 ? ` LIMIT ${limit}` : ''}${offset > 0 ? ` OFFSET ${offset}` : ''}`;
  const sql = `SELECT p.id,p.name,p.category,p.address,COUNT(ph.id) AS photoCount FROM Place p LEFT JOIN PlacePhoto ph ON ph.placeId = p.id WHERE ${conditions.join(' AND ')} GROUP BY p.id${having} ORDER BY p.category,p.name${pagination};`;
  const places = JSON.parse(execFileSync('sqlite3', ['-json', database, sql], { encoding: 'utf8' }) || '[]');
  const requestedIds = new Set((process.env.PLACE_IDS || '').split(',').filter(Boolean));
  return requestedIds.size ? places.filter((place) => requestedIds.has(place.id)) : places;
}

function startBridge() {
  const child = spawn(xhsPython, ['scripts/xhs-batch-bridge.py'], {
    cwd: root,
    env: { ...process.env, XHS_FRAMED: '1', XHS_NOTE_WAIT_SECONDS: process.env.XHS_NOTE_WAIT_SECONDS || '5' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = readline.createInterface({ input: child.stdout });
  let serial = 0;
  const pending = new Map();
  rl.on('line', (line) => {
    if (!line.startsWith('XHSJSON:')) return;
    const response = JSON.parse(Buffer.from(line.slice('XHSJSON:'.length), 'base64').toString('utf8'));
    const callback = pending.get(response.id);
    if (!callback) return;
    pending.delete(response.id);
    response.ok ? callback.resolve(response.data) : callback.reject(new Error(response.error));
  });
  child.on('exit', (code) => {
    for (const callback of pending.values()) callback.reject(new Error(`xhs bridge exited ${code}`));
  });
  return {
    call(operation, payload) {
      const id = `${Date.now()}-${serial++}`;
      child.stdin.write(`${JSON.stringify({ id, operation, ...payload })}\n`);
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { child.stdin.end(); },
  };
}

function cardOf(item) {
  return item.noteCard || item.note_card || {};
}

function tokenOf(item) {
  return item.xsecToken || item.xsec_token || cardOf(item)?.user?.xsecToken || '';
}

function imageUrl(image) {
  const infos = image.infoList || image.info_list || [];
  return infos.find((item) => item.imageScene === 'WB_DFT')?.url
    || infos[0]?.url
    || image.urlDefault
    || image.url_default
    || image.url
    || '';
}

async function download(url, destination) {
  const source = url.replace(/^http:/, 'https:');
  const response = await fetch(source, {
    headers: {
      Referer: 'https://www.xiaohongshu.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`download ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < minShortSide) {
    throw new Error(`image too small ${metadata.width || 0}x${metadata.height || 0}`);
  }
  await writeFile(destination, buffer);
  return { width: metadata.width, height: metadata.height, bytes: buffer.length };
}

async function main() {
  await mkdir(researchDir, { recursive: true });
  const places = loadPlaces();
  const bridge = startBridge();
  const manifest = { generatedAt: new Date().toISOString(), source: 'xiaohongshu', places: [] };

  try {
    for (const [placeIndex, place] of places.entries()) {
      const placeDir = path.join(researchDir, place.id);
      const cachePath = path.join(placeDir, 'result.json');
      await mkdir(placeDir, { recursive: true });
      try {
        const cached = JSON.parse(await readFile(cachePath, 'utf8'));
        manifest.places.push(cached);
        process.stdout.write(`[${placeIndex + 1}/${places.length}] cached ${place.name}: ${cached.images.length}\n`);
        continue;
      } catch {}

      const query = queryFor(place);
      let items = [];
      try {
        items = await bridge.call('search', { query });
      } catch (error) {
        const record = { place, query, error: String(error), notes: [], images: [] };
        await writeFile(cachePath, `${JSON.stringify(record, null, 2)}\n`);
        manifest.places.push(record);
        continue;
      }

      const ranked = items
        .filter((item) => item.id && tokenOf(item) && cardOf(item).type !== 'video')
        .map((item) => ({ item, score: placeScore(place, cardOf(item).displayTitle || cardOf(item).title || '') }))
        .filter(({ item, score }) => queryMode === 'landmark'
          ? score >= 8
          : score >= 20 && isIdentityMatch(place, cardOf(item).displayTitle || cardOf(item).title || ''))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxNotes);

      const record = { place, query, searchedCount: items.length, notes: [], images: [] };
      for (const [noteIndex, rankedItem] of ranked.entries()) {
        const { item } = rankedItem;
        let note = cardOf(item);
        let readError = '';
        try {
          const detail = await bridge.call('read', { noteId: item.id, xsecToken: tokenOf(item) });
          note = detail.note || detail;
        } catch (error) {
          readError = String(error);
        }
        const title = note.title || note.displayTitle || cardOf(item).displayTitle || '';
        const description = note.desc || note.description || '';
        const evidenceText = `${title}\n${description}`;
        const identityMatched = isIdentityMatch(place, evidenceText, true);
        const noteRecord = {
          id: item.id,
          title,
          description,
          publishedAt: note.time || note.lastUpdateTime || null,
          sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}`,
          score: placeScore(place, evidenceText),
          identityMatched,
          readError,
        };
        record.notes.push(noteRecord);
        if (!identityMatched) continue;

        const images = note.imageList || note.image_list || cardOf(item).imageList || [];
        for (const [imageIndex, image] of images.slice(0, maxImagesPerNote).entries()) {
          const url = imageUrl(image);
          if (!url) continue;
          const digest = createHash('sha256').update(url).digest('hex').slice(0, 10);
          const filename = `n${String(noteIndex + 1).padStart(2, '0')}-i${String(imageIndex + 1).padStart(2, '0')}-${digest}.webp`;
          const destination = path.join(placeDir, filename);
          try {
            const metadata = await download(url, destination);
            record.images.push({ filename, noteId: item.id, imageIndex, originalUrl: url, ...metadata });
          } catch (error) {
            record.images.push({ filename, noteId: item.id, imageIndex, originalUrl: url, rejected: String(error) });
          }
        }
      }
      await writeFile(cachePath, `${JSON.stringify(record, null, 2)}\n`);
      manifest.places.push(record);
      const downloaded = record.images.filter((image) => !image.rejected).length;
      process.stdout.write(`[${placeIndex + 1}/${places.length}] ${place.name}: ${record.notes.length} notes, ${downloaded} images\n`);
    }
  } finally {
    bridge.close();
  }
  await writeFile(path.join(researchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await main();
