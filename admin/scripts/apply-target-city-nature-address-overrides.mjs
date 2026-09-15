import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const root = path.resolve(import.meta.dirname, '../..');
const reportRoot = path.join(root, 'data/research/nature-address-overrides-shanghai-suzhou-2026-09-13');
const apply = process.argv.includes('--apply');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const sources = {
  apple: 'Apple 地图中国区（高德底图）点位审计与反向地理编码',
  shanghai: 'https://www.shanghai.gov.cn/cmsres/7c/7c1cd7bc0cbf48b0950054643735bfd8/eb80caad48d598fafb9823a4a1a94064.pdf',
  qingpu: 'https://www.shqp.gov.cn/mac/mac/upload/202405/0531_091330_427.pdf',
  suzhouBay: 'https://www.wujiang.gov.cn/zgwj/mzsy/202411/240aa0733a7f4bc38d7747b857acb4b8/files/6a136c4b203141ce807cd8c61d6b9d50.pdf',
  shilu: 'https://www.suzhou.gov.cn/szsrmzf/szfqt/202411/50ffd75f36d84c6086c7c62d3c96db4b.shtml',
  simingli: 'https://www.sohu.com/a/297445755_556717'
};

const overrides = new Map(Object.entries({
  'nature-036485f7422440c6bc00f89c': ['上海市嘉定区永靖路898弄保利海上五月花东门口', sources.apple],
  'nature-1d1af78698d96680028df98f': ['上海市宝山区美兰湖路545号', 'https://ditu.amap.com/place/B0FFF2V6XW'],
  'nature-25905e29019dc077b850fcf5': ['苏州市吴中区苏州工业园区剑科街9号星澜学校西北侧', 'https://www.sipac.gov.cn/yqjyj/tzgg/202511/6880cd291837431a9a143571789d8a4b.shtml'],
  'nature-27b05c837276d692b9fd753a': ['上海市奉贤区秀竹路与湖畔路交叉口东北侧', sources.shanghai],
  'nature-28f3411f001d0fe87cd79393': ['上海市奉贤区东方美谷大道与望园路交叉口西南侧', 'https://www.shanghai.gov.cn/gwk/search/content/ef9bf708-749a-4be1-8772-425214f62510'],
  'nature-2e9d337ee96a5f358986dc75': ['上海市浦东新区广兰路965号', 'https://www.amap.com/place/B00155QFBS', 31.208674, 121.619766],
  'nature-378ce1f7141b7e3f9256c41c': ['上海市奉贤区年丰路与湖堤路交叉口东侧', sources.shanghai],
  'nature-5853e98941f0fc15f4542f2e': ['上海市青浦区沪青平公路与油墩港交叉口西侧', sources.apple],
  'nature-3246f5433b739da7a213435a': ['上海市嘉定区嘉行公路3749号浏岛大桥南侧', sources.shanghai],
  'nature-60f33c85e3cadd16ce8eab83': ['上海市闵行区镇西路550号', sources.apple],
  'nature-678dfd65e851ba1b62a45c5c': ['上海市金山区板桥西路与山龙街交叉口东北约140米', 'https://gs.ctrip.com/html5/you/sight/shanghai2/4673263.html'],
  'nature-8087836c949252ee7854753d': ['上海市松江区新农河路与蔡家浜路交叉口东北侧', sources.apple],
  'nature-914b96337dafdbee6a4394f5': ['上海市宝山区水产西路与蕰川公路交叉口西南侧', 'https://xxgk.shbsq.gov.cn/article.html?infoid=e6f69573-c455-454b-ad54-7982caca44f1'],
  'nature-941562847047959ba22ff72e': ['上海市松江区新宾路与中天路交叉口东南侧', sources.apple],
  'nature-9459ada0450a805d69208bac': ['上海市浦东新区振桥路与申轮路交叉口西南120米', sources.apple],
  'nature-a845094ea5f66814531c6266': ['上海市松江区北松公路与影维路交叉口西南侧', sources.apple],
  'nature-a80890b1cc55a6891b456629': ['上海市闵行区锦梅路与虹梅南路交叉口西北侧', 'https://www.shanghai.gov.cn/cmsres/ef/ef0f2686120c48e5965bd44936fc76de/288e38e54074cd75fa75c7bf1bbbe067.pdf'],
  'nature-ae01b950aba255e645a2059e': ['上海市浦东新区春眺路与芋秋路交叉口西南侧', sources.apple],
  'nature-b1cf43c6bb0c7d2313cc8988': ['上海市青浦区华青南路与青龙路交叉口东北侧', sources.qingpu],
  'nature-b345224edae5fe79d49657d6': ['上海市浦东新区世博大道与龙滨路交叉口西北侧', sources.apple],
  'nature-ba629897397530acdbda2c38': ['上海市宝山区罗和路与杨南路交叉口西南侧', sources.apple],
  'nature-b8db2db7c0cb622f8f511b0d': ['上海市黄浦区淮海中路425弄', sources.simingli],
  'nature-c1ab4d0bbee101395e4c04db': ['上海市奉贤区南桥路与运河路交叉口东南侧', sources.shanghai],
  'nature-c2f38b1d5b46a57eda3a8aae': ['上海市松江区西林北路与荣乐中路交叉口', 'https://sghexport.shobserver.com/html/baijiahao/2023/09/05/1116839.html'],
  'nature-c22f34e91d1ad7dd564b755f': ['上海市青浦区胜利路与新桥路交叉口', sources.apple],
  'nature-c3f513923d15ebb717a529b2': ['上海市奉贤区秀竹路与湖畔路交叉口东南侧', sources.shanghai],
  'nature-dde9adba5e994214bafa7f2f': ['上海市浦东新区合欢路300号上海图书馆东馆西南侧', sources.apple],
  'nature-ecaa2afdbc766456a6844cbf': ['上海市宝山区走马塘路1225号', sources.apple],
  'nature-fd1eca40c4f002158ef6fe16': ['上海市闵行区沪闵路6669号外环路地铁站北侧', sources.apple],
  'nature-fe33cead99beb2e46e58e98b': ['上海市青浦区青松路与北淀浦河路交叉口西南侧', sources.qingpu],
  'nature-fe5989982822626bbfc70ab1': ['上海市松江区平原街与中昆路交叉口西北侧', sources.apple],
  'nature-map-59af138eb3c4f40e367a3cad': ['苏州市昆山市祖冲之中路与湖亭东路交叉口西侧', sources.apple],
  'nature-map-5f60a680d624a726d3cf5514': ['苏州市太仓市双浮公路与中心路交叉口东侧50米', 'https://hk.trip.com/travel-guide/attraction/taicang/city-143749997'],
  'nature-map-6c2777a3da06dabde6189817': ['苏州市吴中区苏州工业园区阳澄环路仙樱湖公园入口', 'https://www.amap.com/place/B0K36N9MX3'],
  'nature-map-846cc22e1c07c5db5d27ebdf': ['苏州市张家港市凤凰镇凤恬路', 'https://www.amap.com/place/B020015ST0'],
  'nature-map-8c8e8bca9cf8a3f0a99d3f90': ['苏州市张家港市湖南路与湖滨南路交叉口东北100米', 'https://water.suzhou.gov.cn/slj/zjg/202512/8f8eb1797dea4bae9bc61e6ffd6be0bb.shtml'],
  'nature-map-700246af82ef55c9d94f8315': ['苏州市吴中区石路浜巷与秋收路交叉口西侧', sources.shilu],
  'nature-map-889c758d21a64a0459d17afe': ['苏州市太仓市烟沪线与苏州西路交叉口东南角', 'https://ditu.amap.com/place/B0FFHCQL5P'],
  'nature-map-901bb4f26591c18ada744d66': ['苏州市昆山市南星渎路与山淞路交叉口', sources.apple],
  'nature-map-aac79d855d64b079131f2a7d': ['苏州市吴江区湖景街与西学院河交叉口西南侧', sources.suzhouBay],
  'nature-map-b5131ff1d1fd7780930d1f80': ['苏州市姑苏区三香路1346号', 'https://ditu.amap.com/place/B0FFLFLCOF'],
  'nature-map-bc61884f31702851d96218bb': ['苏州市昆山市花桥镇天福路28号', 'https://cwc.mcf.org.cn/about/group-detail/i-144.html'],
  'nature-map-bdfdd66596e587269efe8727': ['苏州市吴中区郭新东路与尹山湖路交叉口南侧', 'https://ditu.amap.com/place/B0G03UFSTD']
}));

const places = await prisma.place.findMany({ where: { id: { in: [...overrides.keys()] } }, orderBy: { id: 'asc' } });
const changes = places.map((place) => {
  const [address, source, latitude = place.latitude, longitude = place.longitude] = overrides.get(place.id);
  return {
    id: place.id,
    name: place.name,
    before: { address: place.address, latitude: place.latitude, longitude: place.longitude },
    after: { address, latitude, longitude },
    source
  };
}).filter((item) => JSON.stringify(item.before) !== JSON.stringify(item.after));

let backupPath = '';
await mkdir(reportRoot, { recursive: true });
if (apply && changes.length) {
  backupPath = path.join(root, 'data/backups/nature-address-overrides-2026-09-13', `dev-before-address-overrides-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  await prisma.$transaction(changes.map((item) => prisma.place.update({
    where: { id: item.id },
    data: { ...item.after, pushedFingerprint: '' }
  })));
}
await prisma.$disconnect();

const report = { generatedAt: new Date().toISOString(), applied: apply, targeted: overrides.size, found: places.length, changes: changes.length, backupPath, records: changes };
await writeFile(path.join(reportRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, targeted: overrides.size, found: places.length, changes: changes.length, backupPath }, null, 2));
