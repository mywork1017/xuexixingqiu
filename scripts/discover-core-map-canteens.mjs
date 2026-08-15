import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const projectRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(projectRoot, 'data', 'research', 'core-map-canteens-2026-08-09');
const outputPath = path.join(outputDirectory, 'results.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const waitMs = Number(process.env.MAP_INTERVAL_MS || 1100);
const districts = [
  ['黄浦区', 31.231, 121.481, ['南京东路', '外滩', '淮海中路', '豫园', '五里桥', '半淞园路', '瑞金二路', '老西门']],
  ['徐汇区', 31.188, 121.436, ['湖南路', '天平路', '枫林路', '斜土路', '田林', '虹梅路', '康健新村', '徐家汇', '凌云路', '龙华', '漕河泾', '长桥', '华泾']],
  ['长宁区', 31.213, 121.405, ['华阳路', '江苏路', '新华路', '周家桥', '天山路', '仙霞新村', '虹桥', '程家桥', '北新泾', '新泾镇']],
  ['静安区', 31.271, 121.454, ['静安寺', '曹家渡', '江宁路', '石门二路', '南京西路', '天目西路', '北站', '宝山路', '芷江西路', '共和新路', '大宁路', '彭浦新村', '临汾路', '彭浦镇']],
  ['杨浦区', 31.296, 121.526, ['定海路', '大桥', '平凉路', '江浦路', '长白新村', '延吉新村', '控江路', '四平路', '殷行', '五角场', '长海路', '新江湾城']],
  ['浦东新区', 31.230, 121.594, ['陆家嘴', '潍坊新村', '塘桥', '南码头路', '周家渡', '上钢新村', '沪东新村', '金杨新村', '洋泾', '浦兴路', '东明路', '花木', '北蔡', '三林', '高行', '高桥', '金桥', '张江', '康桥', '川沙新镇']],
  ['闵行区', 31.111, 121.381, ['江川路', '古美路', '新虹', '浦锦', '莘庄', '七宝', '虹桥镇', '梅陇', '颛桥', '吴泾', '华漕', '马桥']],
  ['嘉定区', 31.375, 121.265, ['嘉定镇', '新成路', '真新', '菊园新区', '安亭', '南翔', '江桥', '马陆']]
];

const queries = districts.flatMap(([district, latitude, longitude, neighborhoods]) => [
  { district, latitude, longitude, query: `${district} 社区长者食堂` },
  { district, latitude, longitude, query: `${district} 社区食堂` },
  ...neighborhoods.map((neighborhood) => ({ district, latitude, longitude, query: `${district}${neighborhood} 长者食堂` }))
]);

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ locale: 'zh-CN' });
await page.goto('https://maps.apple.com.cn/search?query=x&center=31.23,121.47&span=0.8,0.8', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const results = [];
for (const item of queries) {
  const places = await page.evaluate(async ({ query, latitude, longitude }) => {
    const search = new mapkit.Search({
      language: 'zh-CN',
      region: new mapkit.CoordinateRegion(
        new mapkit.Coordinate(latitude, longitude),
        new mapkit.CoordinateSpan(0.35, 0.35)
      )
    });
    return new Promise((resolve, reject) => search.search(query, (error, data) => {
      if (error) reject(new Error(String(error)));
      else resolve(data.places.map((place) => ({
        name: place.name || '',
        address: place.formattedAddress || '',
        latitude: place.coordinate.latitude,
        longitude: place.coordinate.longitude
      })));
    }));
  }, item);
  results.push({ ...item, places });
  process.stdout.write(`${results.length}/${queries.length} ${item.query}: ${places.length}\n`);
  await page.waitForTimeout(waitMs);
}
await browser.close();

const flattened = results.flatMap(({ district, query, places }) => places.map((place) => ({ district, query, ...place })));
const eligible = flattened.filter((place) => /(?:社区|长者|老年|助餐|饭堂|食堂)/.test(place.name) && /(?:食堂|饭堂|助餐|餐厅)/.test(place.name));
const unique = [...new Map(eligible.map((place) => [`${place.name}|${place.address}`, place])).values()];
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'Apple 地图中国区（高德底图）',
  queryCount: queries.length,
  rawCount: flattened.length,
  eligibleCount: eligible.length,
  uniqueCount: unique.length,
  unique,
  queries: results
}, null, 2)}\n`);
process.stdout.write(`地图候选 ${unique.length} 条：${outputPath}\n`);
