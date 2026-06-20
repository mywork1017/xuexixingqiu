# 上海学习地图

微信原生小程序 MVP，用地图展示上海的图书馆、党群服务中心、社区食堂、书店和自习室，并提供地点详情和微信导航。

## 在微信开发者工具中运行

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本仓库，AppID 可先使用测试号，正式发布前替换 `project.config.json` 中的 `appid`。
3. 开通云开发环境，确认 `project.config.json` 中 `cloudfunctionRoot` 为 `cloudfunctions/`。
4. 创建云数据库集合 `places`，读取权限可按 `database/places.permissions.json` 设置为所有用户可读。
5. 右键 `cloudfunctions/getPlaces`，选择“上传并部署：云端安装依赖”。
6. 编译预览。云数据为空或云函数不可用时，页面会显示本地内置地点。

## 地点数据

地点集合字段见 `database/places.schema.json`。第一批数据可从 `data/places-template.csv` 复制扩展。

必填字段：

- `name`
- `category`
- `latitude`
- `longitude`
- `address`

支持分类：

- 图书馆
- 党群服务中心
- 社区食堂
- 书店
- 自习室

推荐导入方式：

1. 编辑 `data/places-template.csv`。
2. 运行 `npm run build:places`，生成 `data/places-import.json`。
3. 在云开发数据库的 `places` 集合中导入 `data/places-import.json`。
4. 导入模式优先选择按 `_id` 覆盖或更新。每条地点的 `_id` 会根据分类、名称、地址稳定生成，后续改内容后可覆盖同一条记录。

## 项目结构

- `miniprogram/pages/map`：地图首页，包含分类筛选、定位、marker 和底部地点卡。
- `miniprogram/pages/list`：地点列表页，支持分类浏览。
- `miniprogram/pages/detail`：地点详情页，支持电话和微信导航。
- `miniprogram/utils/place-utils.js`：地点归一化、筛选、marker 转换、CSV 解析。
- `cloudfunctions/getPlaces`：读取 `places` 集合的云函数。

## 本地验证

```bash
npm test
```

当前自动化测试覆盖地点分类、坐标归一化、marker 转换和 CSV 模板解析。
