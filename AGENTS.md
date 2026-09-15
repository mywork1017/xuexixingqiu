# 上海学习地图开发协作规则

## 基本流程

后续迭代小程序样式、功能和云开发能力时，按下面流程协作：

1. 用户在 Codex 里描述要改的目标。
2. Codex 修改项目代码。
3. Codex 运行自动化测试和必要检查。
4. 用户回到微信开发者工具，点击“编译”。
5. 用户在开发者工具模拟器里查看效果。
6. 如果效果需要调整，用户截图或描述问题，Codex 继续修改。
7. 效果满意后，用户点击“预览”，用手机扫码真机测试。
8. 准备给别人试用时，用户在微信开发者工具点击“上传”。

## Codex 必须遵守

- 普通页面样式或功能改动完成后，提醒用户在微信开发者工具点击“编译”验证。
- 如果改动涉及 `cloudfunctions/` 下的云函数，必须提醒用户重新上传对应云函数。
- 地点数据以管理后台 SQLite 为唯一主库；新增、批量修改和删除由 Codex 维护，后台网站只查阅、调整现有字段和推送。
- CSV 只用于后台导出备份，不参与数据导入、生成或回写。
- 每次声明开发完成前，必须运行可用的测试或检查命令，并说明结果。
- 处理点位发现、来源采集、定位、校验、图片、简介、SQLite 入库或云端发布前，必须完整阅读并遵守 `docs/place-data-maintenance.md`。网页和图片候选优先使用 Crawl4AI 多渠道采集；地点身份无法准确确认时留空。
- 每张最终图片必须由 Codex 查看完整画面并阅读图片文字；自动识别只作初筛，裁切或压缩后需要重新终审。
- 公开采集图片和用户提供图片均可保留正常使用场景中的自然人群或远景小人物；人物特写、专门拍人、人物主导画面、看镜头互动的图片继续淘汰。用户明确指定构图时不得自行裁掉自然人群。
- 图片补充应主动覆盖小红书、大众点评等社交媒体公开内容；平台水印和账号标识仅通过裁切完整去除，无法干净裁除时淘汰图片。
- 简介只写当前准确地点可验证的实用事实，禁止平台名、营销词、空泛场景词和完整地点名重复。
- 开发小程序界面时，不在页面上写产品策略、设计策略或数据规则，除非用户明确要求展示给用户。
- 如果用户已经明确技术方案，优先重复尝试该方案；需要降级时只能选择相近方案，并先告知用户。
- 不使用“不是……而是……”“不是……是……”或 “not...but...” 这类表达。

## 常用验证

```bash
npm test
```

如果修改了 JS 文件，也应做语法检查：

```bash
for f in $(find miniprogram cloudfunctions tests scripts -name '*.js' -print); do node --check "$f" || exit 1; done
```

## 微信开发者工具操作提醒

- 页面、样式、交互改动：用户点击“编译”即可看到效果。
- 云函数改动：用户右键对应云函数目录，选择“上传并部署：云端安装依赖”。
- 数据改动：用户在后台点击“推送到小程序”，将变化或云端缺失的地点同步到云开发数据库 `places` 集合，并清理主库已删除的云端记录。

## Context Engine (CCE)

This project keeps a local Code Context Engine index for on-demand code
retrieval. The CCE MCP server is disabled globally to avoid persistent Python
background processes.

### Searching the codebase

Use `cce search "<query>" --top-k 5` from the project root when exploring the
codebase, answering questions about code, or finding related implementation
patterns. Keep command output short and read only the files needed for the
current task.

When to use `cce search`:
- Answering questions about the codebase ("how does X work?", "where is Y?")
- Exploring structure or architecture
- Finding related code, functions, or patterns

### Cross-session memory

Use the repo docs and existing memory workflow for non-trivial questions. If
CCE results are stale, run `cce index` during a quiet moment.

### Output style

Respond in compressed style. Drop articles (a, an, the) in prose. Use
sentence fragments over full sentences. Use short synonyms (fix not resolve,
check not investigate). Pattern: [thing] [action] [reason]. [next step].
No filler, hedging, pleasantries, trailing summaries, or restating what
the user said. One sentence if one sentence is enough.

When suggesting code changes, show only the changed lines with 3 lines of
context. Never rewrite entire files. Multiple changes in one file: show each
change separately. Never echo back unchanged code the user already has.

Code blocks, file paths, commands, error messages: always written in full.
Security warnings and destructive action confirmations: use full clarity.
