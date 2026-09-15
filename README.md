# 通仔的星球

微信原生小程序 MVP，用地图展示六个支持城市的图书馆、食堂与自然空间，并提供地点详情和微信导航。

## 在微信开发者工具中运行

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本仓库的 `miniprogram/` 目录；AppID 已写入该目录的 `project.config.json`。
3. 开通云开发环境，确认 `project.config.json` 中 `cloudfunctionRoot` 为 `cloudfunctions/`。
4. 创建云数据库集合 `places`，读取权限可按 `database/places.permissions.json` 设置为所有用户可读。
5. 创建云数据库集合 `visitLogs`，权限按 `database/visitLogs.permissions.json` 设置为客户端不可读写。
6. 右键 `cloudfunctions/getPlaces` 和 `cloudfunctions/recordVisit`，分别选择“上传并部署：云端安装依赖”。
7. 在腾讯位置服务控制台创建或选择已开启 WebServiceAPI 的 Key，为 `recordVisit` 云函数配置 `TENCENT_MAP_KEY` 环境变量，用于把授权坐标解析到上海区县。
8. 编译预览。云数据为空或云函数不可用时，页面会显示对应错误状态。

## 地点数据

管理后台 SQLite 是地点唯一主库。地点集合字段见 `database/places.schema.json`，程序不连接或导入其他地点数据库。

必填字段：

- `name`
- `category`
- `latitude`
- `longitude`
- `address`

支持分类：

- 图书馆
- 食堂
- 自然（公园、绿地、山林、湖岸、湿地与滨水风光带）

排除城市书房，以及名称未明确包含“图书馆”的党群、党建或社区文化中心点位。学校、单位和机关内部场所不收录。食堂仅收录社区食堂、长者食堂及公益助餐场所。自然类收录公开的公园、绿地、游园、湿地、森林及河湖滨水风光带。

城市范围当前覆盖上海、苏州、嘉兴、南通、无锡、镇江；新增城市沿用同一收录、地址完整性、坐标校验和去重规则。

维护与发布：

1. 使用 Codex 维护后台 SQLite 主库；管理后台用于查阅、调整现有字段和照片。
2. 运行 `npm run audit:places` 检查后台主库。
3. 在后台点击“推送到小程序”，仅将变化或云端缺失的地点同步到云开发数据库 `places` 集合，并清理主库已删除的云端记录。
4. 需要离线备份时，在后台点击“导出 CSV 备份”。

## 项目结构

- `miniprogram/pages/map`：地图首页，包含分类筛选、定位、marker 和底部地点卡。
- `miniprogram/pages/detail`：地点详情页，展示地址、开放信息、简介、照片并支持微信导航。
- `miniprogram/utils/place-utils.js`：地点归一化、筛选和 marker 转换。
- `cloudfunctions/getPlaces`：读取 `places` 集合的云函数。
- `cloudfunctions/recordVisit`：记录匿名访客、定位区县、精度和访问时间的云函数。

启用定位访问记录前，还需在微信公众平台的用户隐私保护指引中声明：定位信息会用于地图定位、附近地点计算和匿名区县访问统计。

## 本地验证

```bash
npm test
```

当前自动化测试覆盖地点分类、坐标归一化和 marker 转换。
