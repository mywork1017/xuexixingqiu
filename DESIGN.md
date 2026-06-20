# 上海学习地图 Design

这份规范用于约束微信小程序真实界面。每次改地图页、详情页、我的页、公共按钮、tabbar、marker 或页面背景时，先读本文件，再对照 PRD 目标 HTML。

## 设计基准

- 地图页目标：`design-reference/map.html`
- 详情页目标：`design-reference/detail.html`
- 我的页目标：`design-reference/mine.html`
- 共享样式：`design-reference/reference.css`
- 并排检查：`design-reference/compare.html`
- 差异记录：`design-reference/diff-notes.md`

后续开发以这 3 份目标 HTML 的视觉结构为准。微信开发者工具截图只作为当前实现状态，用来和目标 HTML 比差异。

## Design Intent

- Product feel: 海派夜读、暗色高级、安静、地方感、地图优先。
- Density: 移动端紧凑工具界面，信息密度高，触控面积清楚。
- Primary UI surfaces: 墨黑底、金色控件、真实照片氛围、深色列表、暖象牙地图卡片。
- Avoid: 营销口号、天气挂件、印章装饰、搜索优先布局、浅色卡片堆叠、在界面暴露产品策略或设计规则。

## Tokens

### Color

- `bg-ink`: `#071112`，全局主背景。
- `bg-ink-deep`: `#050b0c`，导航、遮罩和深层背景。
- `bg-ink-soft`: `#10251e`，深绿承托色。
- `surface-paper`: `#f5ead8`，地图底部地点卡主面。
- `surface-paper-soft`: `#fff8ea`，浅色按钮和图标底。
- `surface-paper-muted`: `#e8dac1`，地图卡片渐变次色。
- `text-on-dark`: `#f4ead8`，暗底主文字。
- `text-on-dark-muted`: `#bcae99`，暗底说明文字。
- `text-on-paper`: `#102724`，浅底主文字。
- `text-on-paper-muted`: `#5f6d65`，浅底说明文字。
- `accent-gold`: `#e8c47d`，主强调色。
- `accent-gold-deep`: `#b78b46`，边框、箭头、分割线。
- `accent-copper`: `#b8894d`，书店和次级强调。
- `control-green`: `#143924`，暗绿按钮底。
- `line-gold`: `rgba(232, 196, 125, 0.2)`，暗底细分割线。

### Category Color

- 图书馆：`#7f9661`
- 书店：`#b8894d`
- 自习室：`#7471b8`
- 党群服务中心：`#b74b42`
- 社区食堂：`#a8b85a`
- 全部：`#d2a66b`

### Typography

- Body: `PingFang SC`, `-apple-system`, `BlinkMacSystemFont`, `Helvetica Neue`, `Arial`, sans-serif.
- PRD-facing titles: `Songti SC`, `STSong`, serif.
- Large page title: `38rpx` to `40rpx`, weight `500`, color `#f1dfbd`.
- Detail place title: `54rpx`, Songti, weight `500`, line-height `1.15`.
- Mine nickname: `48rpx`, Songti, weight `500`.
- Map card place title: `46rpx`, Songti, weight `500`.
- Section title: `35rpx` to `38rpx`, Songti, gold.
- Body text: `27rpx` to `30rpx`, line-height `1.35` to `1.65`.
- Letter spacing: keep `0` for normal text; only page titles may use `1rpx` to `2rpx`.

## Layout And Shape

- Page padding: `24rpx` on map overlays, `34rpx` detail content, `38rpx` mine content.
- Phone-first canvas: all pages target WeChat mobile viewport; avoid desktop-style centered panels.
- Minimum touch target: `80rpx`.
- Pill controls: `999rpx`.
- Small controls and buttons radius: `14rpx` to `18rpx`.
- Map sheet radius: `34rpx`.
- Dark list rows use separators and transparent backgrounds.
- Avoid nested cards. Use one surface per functional unit.
- Text must wrap within its container; long place names keep `min-width: 0` on text columns.

## Shared Components

### Navigation

- Use custom nav metrics from `getNavMetrics`.
- Page title is visually centered across the whole screen.
- Detail back button is an absolute left control; title remains centered.
- Nav text uses Songti and `#f1dfbd`.
- Nav background on detail is `rgba(5, 11, 12, 0.96)`.

### Category Chips

- Chips are fixed-height pills.
- Map page chip height: `56rpx`.
- Detail nearby chip height: `58rpx`.
- Active chip: dark green translucent fill, green border, warm white text.
- Inactive chip: dark translucent fill, gold/copper border, paper text.
- Fixed widths follow current data layer:
  - 全部：`92rpx`
  - 图书馆：`132rpx`
  - 书店：`116rpx`
  - 自习室：`132rpx`
  - 党群服务中心：`190rpx`
  - 社区食堂：`164rpx`
- WeChat `button` defaults must be neutralized with `padding: 0`, `margin: 0`, `min-width: 0`, `max-width: none`, and `button::after { border: 0; }`.

### Buttons

- Dark page primary actions use dark green gradients with gold border and gold text.
- Map card actions use muted paper fill, copper border, dark text.
- Buttons use icons or compact glyphs where natural.
- Button labels must stay inside the button at narrow widths.
- Two-column action rows use equal `1fr` tracks.
- Three action buttons in map sheet use `repeat(3, 1fr)`.

### Icons And Badges

- Category icons are circular, gold-bordered, and set on dark green.
- Selected map marker uses a stronger visual treatment than unselected markers.
- Marker assets in `miniprogram/assets/markers/` are preferred over CSS-only marker drawings.
- Avatar and category circles use subtle inset shadow or radial glow.

### Tabbar

- Custom tabbar is black/gold, fixed to bottom.
- Height: `calc(156rpx + env(safe-area-inset-bottom))`.
- Background: `linear-gradient(180deg, rgba(28, 28, 26, 0.96), #10100f)`.
- Active label color: `#e8c47d`.
- Inactive label color: `#9a958e`.
- Active state includes a short gold underline.
- Icon size: `48rpx`.

## Page Rules

### Map Page

- Target reference: `design-reference/map.html`.
- The map remains the first-screen base layer.
- Apply a dark filter/scrim so native map output fits the PRD dark visual.
- Header contains centered title and a single horizontal category scroll.
- Category row should feel compact and close to the PRD HTML, with small gaps and fixed chip widths.
- Location button floats above the bottom sheet at the right side.
- Bottom sheet:
  - Warm ivory gradient surface.
  - Left/right inset near `20rpx`.
  - Radius `34rpx`.
  - Minimum height around `342rpx`.
  - Large circular category icon.
  - Songti place name.
  - Address, hours, tags, distance, divider, and 3 action buttons.
- Sheet should float above tabbar and leave the hierarchy clear.
- Native map roads, POI labels, copyright and water tiles may drift from the PRD HTML. Keep UI overlays aligned first.

### Detail Page

- Target reference: `design-reference/detail.html`.
- Use a real top cover image, currently `/assets/backdrops/detail-cover.png`.
- The cover starts directly below the custom nav.
- Page stays dark; sections are transparent blocks divided by gold hairlines.
- Hero structure:
  - Large gold-bordered circular category icon.
  - Songti place title.
  - Muted address text.
- Top actions are two equal dark green/gold outline buttons.
- Section headings are gold Songti text.
- Detail map is a darkened map block with gold border and small radius.
- Tags are gold outline pills.
- Nearby places are list rows on dark background, with circular category icon, text, distance and gold arrow.
- Avoid returning this page to light card stacks.

### Mine Page

- Target reference: `design-reference/mine.html`.
- Use a real library atmosphere backdrop, currently `/assets/backdrops/mine-library.png`.
- Backdrop sits behind the account area with a dark overlay.
- Account area floats on the dark image:
  - Round avatar, Songti nickname, login pill, settings control.
  - No large light account card.
- Favorites section is a dark list:
  - Gold section title and count.
  - Row separators with subtle gold alpha.
  - Circular category badge.
  - Songti place name, muted metadata, gold arrow.
- Empty state remains dark and quiet, using dashed gold border and muted text.
- If comparing to an empty-state PRD image, set sample data accordingly before judging layout.

## Assets

- PRD HTML uses image assets under `design-reference/assets/`.
- Mini program runtime assets live under `miniprogram/assets/`.
- Detail cover: `miniprogram/assets/backdrops/detail-cover.png`.
- Mine backdrop: `miniprogram/assets/backdrops/mine-library.png`.
- Marker assets: `miniprogram/assets/markers/`.
- When a design calls for a photo, use a real bitmap asset. A nearby fallback can be a still image or GIF; avoid replacing it with a rough CSS imitation.

## Motion And Interaction

- Keep interactions calm and utility-focused.
- Micro states may use opacity, border color, and background changes.
- Avoid decorative motion that competes with map reading.
- Respect reduced-motion needs when adding animation.
- Horizontal chips use `scroll-view`, no wrapping into multiple rows.

## Accessibility

- Maintain `80rpx` minimum touch targets for interactive elements.
- Gold text on dark background must keep strong contrast.
- Muted text on paper must stay readable.
- Icon-only buttons need accessible labels in WXML where possible.
- Do not allow text to overlap icons, buttons, nav, tabbar or safe areas.

## Implementation Checklist

- Read the relevant target HTML before changing a page.
- Reuse existing classes and component structure before adding new patterns.
- Keep product strategy, design rationale and data rules out of visible UI copy.
- Preserve user-confirmed technical direction. If a fallback is needed, state it before changing route.
- For JS changes, run:

```bash
for f in $(find miniprogram cloudfunctions tests scripts -name '*.js' -print); do node --check "$f" || exit 1; done
```

- For every completed development change, run:

```bash
npm test
```

- For page, style or interaction changes, tell the user to click “编译” in WeChat Developer Tools.
- For cloud function changes, tell the user to upload and deploy the affected cloud function.
- For place data import changes, edit `data/places-template.csv`, then run `npm run build:places`.
