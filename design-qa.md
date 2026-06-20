source visual truth path:
- /var/folders/27/plpsyhz172gdcyyxwcj1v6880000gn/T/codex-clipboard-072ed494-ea30-47d0-9791-f01c225e17ae.png
- /var/folders/27/plpsyhz172gdcyyxwcj1v6880000gn/T/codex-clipboard-8018569a-1f4a-4706-8447-0588600af9e3.png
- /var/folders/27/plpsyhz172gdcyyxwcj1v6880000gn/T/codex-clipboard-e95e4800-388e-466b-b802-7c9374dc16b9.png

implementation screenshot path:
- blocked: WeChat DevTools CLI requires service port enablement, then times out waiting for `/Users/tongwang/Library/Application Support/微信开发者工具/50a7d9210159a32f006158795f893857/Default/.ide`.

viewport:
- iPhone-style WeChat mini program simulator, portrait, reference screenshots are 864 x 1664.

state:
- Map tab with `静安区党群服务中心` selected.
- Detail page for `静安区党群服务中心`.
- Mine tab with empty favorites.

full-view comparison evidence:
- Source images were opened and reviewed.
- Implementation runtime screenshot capture is blocked by WeChat DevTools CLI service-port timeout.

focused region comparison evidence:
- Focused visual targets reviewed from source images: map header and filters, selected-place bottom card, custom tabbar, detail header and cards, mine account card and empty state.
- Focused implementation screenshot capture is blocked by the same CLI issue.

findings:
- [P0] Runtime screenshot comparison blocked.
  Location: WeChat DevTools CLI automation.
  Evidence: `cli open --project ... --port 9420 --lang zh` prompts for service-port enablement; after confirming `y`, it fails with `#initialize-error: wait IDE port timeout`.
  Impact: Cannot honestly claim a measured 90% visual match from machine-captured implementation screenshots in this run.
  Fix: In WeChat DevTools, open Settings -> Security Settings and enable Service Port. Then rerun CLI capture or manually screenshot the three target states.

patches made since previous QA pass:
- Added custom tabbar to match the dark bottom navigation in the screenshots.
- Changed the map default state to select `静安区党群服务中心`.
- Synced all starter CSV places into local sample data for map marker density.
- Added selected marker PNG assets with outer highlight rings.
- Adjusted map filter chips to wide pill controls.
- Adjusted map bottom card spacing, status, tags, and action buttons.
- Adjusted detail page top back pill, title sizing, cards, map section, and nearby filter pills.
- Kept mine page empty-state structure and dark-to-paper visual split aligned to the supplied screenshot.

final result: blocked
