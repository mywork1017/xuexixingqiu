import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const query = process.argv.slice(2).join(' ') || '上海 图书馆 自习室 书店 社区食堂';
const configPath = process.env.XCRAWL_API_KEY_FILE
  ? process.env.XCRAWL_API_KEY_FILE.replace('$HOME', os.homedir())
  : path.join(os.homedir(), '.xcrawl', 'config.json');
const adminBaseUrl = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3000';

function readApiKey() {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  return config.XCRAWL_API_KEY || config.apiKey;
}

async function searchXcrawl(apiKey) {
  const response = await fetch('https://run.xcrawl.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      limit: 20,
      locale: 'zh-CN'
    })
  });

  if (!response.ok) {
    throw new Error(`XCrawl search failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function normalizeCandidates(payload) {
  const results = payload.results || payload.data || [];
  return results.map((item) => ({
    name: item.title || item.name || item.url || '未命名候选地点',
    category: '',
    address: '',
    latitude: null,
    longitude: null,
    hours: '',
    description: item.snippet || item.description || '',
    tags: [],
    photos: [],
    source: 'xcrawl-search',
    sourceUrl: item.url || '',
    raw: item
  }));
}

async function pushCandidate(candidate) {
  const response = await fetch(`${adminBaseUrl}/api/admin/import-candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate)
  });

  if (!response.ok) {
    throw new Error(`Import candidate failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

const apiKey = readApiKey();
const payload = await searchXcrawl(apiKey);
const candidates = normalizeCandidates(payload);

for (const candidate of candidates) {
  await pushCandidate(candidate);
}

console.log(`Imported ${candidates.length} candidates for query: ${query}`);
