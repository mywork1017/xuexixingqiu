# 通仔的学习星球

微信原生小程序 MVP，用地图展示上海的图书馆和食堂，并提供地点详情和微信导航。

## 在微信开发者工具中运行

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本仓库的 `miniprogram/` 目录；AppID 已写入该目录的 `project.config.json`。
3. 开通云开发环境，确认 `project.config.json` 中 `cloudfunctionRoot` 为 `cloudfunctions/`。
4. 创建云数据库集合 `places`，读取权限可按 `database/places.permissions.json` 设置为所有用户可读。
5. 右键 `cloudfunctions/getPlaces`，选择“上传并部署：云端安装依赖”。
6. 编译预览。云数据为空或云函数不可用时，页面会显示本地内置地点。

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

排除城市书房，以及名称未明确包含“图书馆”的党群、党建或社区文化中心点位。学校、单位和机关内部场所不收录。食堂仅收录社区食堂、长者食堂及公益助餐场所。

维护与发布：

1. 使用 Codex 维护后台 SQLite 主库；管理后台用于查阅、调整现有字段和照片。
2. 运行 `npm run audit:places` 检查后台主库。
3. 在后台点击“推送到小程序”，完整同步到云开发数据库 `places` 集合。
4. 需要离线备份时，在后台点击“导出 CSV 备份”。

## 项目结构

- `miniprogram/pages/map`：地图首页，包含分类筛选、定位、marker 和底部地点卡。
- `miniprogram/pages/detail`：地点详情页，展示地址、开放信息、简介、照片并支持微信导航。
- `miniprogram/utils/place-utils.js`：地点归一化、筛选和 marker 转换。
- `cloudfunctions/getPlaces`：读取 `places` 集合的云函数。

## 本地验证

```bash
npm test
```

当前自动化测试覆盖地点分类、坐标归一化和 marker 转换。
