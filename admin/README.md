# 上海学习地图管理后台

自建服务器方向的后台网站，用来查阅地点、调整现有字段和照片，并将主库推送到小程序。

## 本地启动

```bash
cd admin
cp .env.example .env.local
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

打开 `http://127.0.0.1:3000/login`，使用固定账号 `tongzai` 和 `.env.local` 里的 `ADMIN_PASSWORD` 登录。后台只提供这一组管理员账号。

## 数据流

- 地点列表和编辑表单维护现有 `Place` 与 `PlacePhoto`，不在网站新增或删除点位。
- 地点简介只保存热水、厕所、电源插座、Wi-Fi 和具体环境相关的已知信息，可为空。
- 照片上传后统一按视觉主体裁成正方形 WebP，每个地点最多 5 张。
- 网站不调用任何大模型；数据补充和批量维护通过 Codex 完成。
- 编辑地址时重新定位经纬度；日常批量调整由 Codex 直接维护主库。
- 后台 SQLite 是地点唯一主库。
- “导出 CSV 备份”生成离线快照，不参与数据回写。

## 推送到线上小程序

自建后台服务器配置以下环境变量后，地点管理页会通过腾讯云 CloudBase 服务端 SDK 将后台全部地点覆盖写入微信云数据库 `places` 集合：

```bash
CLOUDBASE_ENV_ID="云开发环境 ID"
TENCENTCLOUD_SECRET_ID="腾讯云 SecretId"
TENCENTCLOUD_SECRET_KEY="腾讯云 SecretKey"
CLOUDBASE_COLLECTION="places"
CLOUDBASE_VISIT_COLLECTION="visitLogs"
```

密钥只配置在服务器环境变量中，不写入浏览器或数据库。点击“推送到小程序”后，小程序线上版继续通过 `getPlaces` 云函数读取这些数据。

访问记录页从云数据库 `visitLogs` 集合读取最近 500 条定位记录。`recordVisit` 云函数还需配置已开启 WebServiceAPI 的腾讯位置服务 `TENCENT_MAP_KEY`，用于把用户授权后的坐标解析到区县；云数据库只保存区县、匿名访客编号、定位精度和云端时间。
