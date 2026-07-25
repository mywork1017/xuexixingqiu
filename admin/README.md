# 上海学习地图管理后台

自建服务器方向的后台网站，用来管理地点、照片、图片识别填表和初始数据采集候选。

## 本地启动

```bash
cd admin
cp .env.example .env.local
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

打开 `http://127.0.0.1:3000/login`，使用 `.env.local` 里的 `ADMIN_PASSWORD` 登录。

## 数据流

- 地点列表和表单维护 `Place` 与 `PlacePhoto`，每个地点最多 5 张照片。
- 地点设施使用一段自由文本，开水、厕所、插座、Wi-Fi 等信息统一写入该字段。
- 图片或粘贴内容通过 `POST /api/admin/places/extract-from-image` 整理，需要 `IMAGE_EXTRACT_API_KEY`；识别结果经勾选后填入表单。
- 小程序导出接口是 `GET /api/admin/places/export`，输出字段兼容现有 `places` 数据。
- 上海市文旅局名录和 OpenStreetMap 数据写入 `ImportCandidate`，人工确认后再进入正式地点。

## 长期抓取与审核

打开 `/import-candidates`，可随时重新抓取上海市文旅局名录或 OpenStreetMap。重复记录会更新现有候选，疑似同名或同地址地点会标为“疑似已有”。

候选详情支持修改抓取内容、合并到已有地点、保存草稿、审核发布和忽略。小程序导出接口只返回已发布地点。

地址与坐标可通过 OpenStreetMap Nominatim 免费搜索补齐，保存到小程序前使用 GCJ-02 坐标。

## 推送到线上小程序

自建后台服务器配置以下环境变量后，地点管理页会通过腾讯云 CloudBase 服务端 SDK 将所有“已发布”地点覆盖写入微信云数据库 `places` 集合：

```bash
CLOUDBASE_ENV_ID="云开发环境 ID"
TENCENTCLOUD_SECRET_ID="腾讯云 SecretId"
TENCENTCLOUD_SECRET_KEY="腾讯云 SecretKey"
CLOUDBASE_COLLECTION="places"
```

密钥只配置在服务器环境变量中，不写入浏览器或数据库。点击“推送到小程序”后，小程序线上版继续通过 `getPlaces` 云函数读取这些数据。

## XCrawl 配置

使用 GitHub 仓库 `xcrawl-api/xcrawl-skills` 的 API 约定，本地配置文件：

```json
{
  "XCRAWL_API_KEY": "你的 key"
}
```

默认路径为 `~/.xcrawl/config.json`。采集脚本：

```bash
node scripts/xcrawl-seed.mjs "上海 图书馆 自习 书店 社区食堂"
```

脚本会搜索候选结果，并把结果提交到后台的 `ImportCandidate` API。
