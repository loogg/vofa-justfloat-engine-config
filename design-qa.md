# Design QA — Win11 Fluent utility redesign

## Evidence

- Source visual truth:
  - `design-qa-assets/source-current-dashboard.png` — original 1264×755 Electron UI and the oversized region marked by the user.
  - `design-qa-assets/source-repository-fixed.png` — fixed repository fields that prevented standalone distribution.
  - `design-qa-assets/source-overflow-font-1306x781.png` — the user's selected-field state showing the local editor overflow and typography concern.
  - `design-qa-assets/source-word-card-ambiguity.png` — the compact Word cards that visually merged `Word 0` with `1 字段`, and exposed the lack of channel-region grouping.
  - `design-qa-assets/source-selected-region.png` — the overly strong selected-region treatment.
  - `design-qa-assets/source-native-confirm.png` — the browser/OS confirmation dialog that did not match the app.
  - `design-qa-assets/source-flat-channel-list.png` — the flat output list without Word parent nodes.
  - The user's written Fluent 2 brief is authoritative for intentional visual changes: compact Windows utility, 4px spacing grid, 28–32px controls, neutral surfaces, one accent color, thin borders, low decoration, no gradients/glass/hero/dashboard treatment.
- Final implementation:
  - `design-qa-assets/implementation-sidebar-project-1280x820.png`
  - `design-qa-assets/implementation-sidebar-layout-1280x820.png`
  - `design-qa-assets/implementation-sidebar-build-1280x820.png`
  - Corresponding `980x680` captures are stored beside them.
  - `design-qa-assets/implementation-win11-font-1306x781.png` — final selected-field state after the boundary and Win11 typography pass.
  - `design-qa-assets/implementation-win11-font-980x680.png` — final minimum-window selected-field state.
  - `design-qa-assets/implementation-channel-v2-1306x781.png` — final Word/channel-region/table design.
  - `design-qa-assets/implementation-channel-v2-980x680.png` — final minimum-window channel design.
  - `design-qa-assets/implementation-select-focus-detail.png` — focused Win11 dropdown treatment.
  - `design-qa-assets/implementation-selection-v11.png` — final restrained selected-field treatment.
  - `design-qa-assets/implementation-confirm-v11.png` — final in-app Fluent confirmation dialog.
  - `design-qa-assets/implementation-description-dialog-v11.png` — final offline three-language generation confirmation.
- Combined comparison inputs:
  - `design-qa-assets/comparison-full-v2.png`
  - `design-qa-assets/comparison-focused-v2.png`
  - `design-qa-assets/comparison-overflow-font-v3.png`
  - `design-qa-assets/comparison-word-card-v4.png`
  - `design-qa-assets/comparison-selection-v5.png`
  - `design-qa-assets/comparison-confirm-v5.png`
- Viewport and density: 1280×820, 980×680, and the user's exact 1306×781 selected-field state at device scale factor 1. The 1305px-wide source image was normalized by one pixel to 1306×781 for the side-by-side comparison. No browser or device chrome was compared.
- State: first page “工程设置”, second page “通道布局”, third page “构建输出”; repository intentionally unselected to exercise the visible missing-environment state.

## Full-view comparison

The original used a dark SaaS/dashboard composition with a large promotional hero, nested cards, oversized empty space, and all workflow sections in one long page. The final implementation uses a 48px application bar, a 192px Win11 Settings-style navigation rail, one focused page at a time, flat section separators, a persistent 52px command bar, and compact engineering controls. “通道布局” is the second navigation item as explicitly requested.

## Focused-region comparison

The focused comparison covers the original hero/engine area against the final layout page. The large marketing block is gone; the same space now carries the Word selector, byte/bit grid, field editor, precision notice, and channel table. Text and control detail remain readable at 1280×820 and 980×680. A separate crop was unnecessary because the combined focused image keeps the relevant labels and controls legible.

`comparison-word-card-v4.png` separately normalizes the user's narrow Word-card crop against the final cards. It confirms that the index, field count, and capacity no longer form ambiguous adjacent numbers.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable Text for Latin UI text, Segoe UI Variable Display for page hierarchy, and Microsoft YaHei UI for Chinese glyphs. Body/buttons/channel names are 14px regular, labels are 13px regular, helper text is 12–13px, and semibold is limited to real hierarchy/active states. Chromium uses the Windows default rasterization; Cascadia Mono remains only for identifiers and raw data.
- Spacing and layout rhythm: 4px-based spacing, 30px inputs, 32px navigation rows, 4–6px radii, 12–16px section gaps, thin dividers, and no content hidden behind the persistent command bar. All six page/viewport states have no horizontal overflow.
- Colors and tokens: neutral light Windows surfaces, subtle gray borders, Fluent blue `#0F6CBD` as the single interaction accent, and semantic warning/error colors only where required. No gradients, glassmorphism, glow, or decorative background shapes remain.
- Image quality and asset fidelity: the app icon is a generated, genuinely transparent RGBA raster with multi-size PNG/ICO outputs; its 2×2 byte block and three-way split remain legible at 16/24/32px. All control icons are copied from Microsoft Fluent UI System Icons; renderer checks report no missing images.
- Copy and content: labels follow the engineering workflow (“工程设置 / 通道布局 / 构建输出”), one engine name visibly derives target/class/DLL/JSON, three language descriptions are editable, and environment failures name the missing requirements before build.

## Interaction and accessibility checks

- Sidebar navigation switches all three pages, updates `aria-current`, hides inactive pages, and moves focus to the active page heading.
- Starting a build switches to “构建输出”; editing a channel switches to “通道布局”.
- Repository selection, description tabs, Word selection, field editing, environment dialog, load/save, generate, build, and log controls remain wired.
- 1280×820 and 980×680 captures show no missing assets, no console errors, no page-level horizontal overflow, and visible keyboard focus treatment.
- In the exact 1306×781 ch0 edit state, document/body/page/workbench/editor/editor-row/allocation/actions/table all report zero horizontal overflow and remain inside the page boundary. The workspace retains only 23px of expected main-page vertical scroll; no child panel is clipped.
- Word cards expose `Word`, the index badge, field count, and `used/32 bits` as separate nodes. A 32-bit channel renders as one channel-colored region across all four Byte rows with one `chN` label per row, so it cannot be mistaken for a one-byte field.
- Hovering a current-Word channel region highlights the matching output row; hovering a table row highlights its Word card/usage bar and, when visible, the matching bit region. Physical `ch` colors remain stable when the table view is sorted.
- All selects use native keyboard behavior with `appearance:none`, an external Microsoft Fluent chevron mask, Win11 hover/focus/disabled states, and no horizontal overflow.
- Selected fields retain their channel color, use only the region outer edge plus a compact `已选 ch · type · bytes` summary, and do not outline every internal bit cell.
- Output channels use a semantic `treegrid`: Word rows are level-1 expandable parents, ch rows are level-2 children, and collapsed state is keyboard accessible.
- Destructive and replacement actions use the app's Fluent modal instead of `window.confirm`; the dialog states the affected Word/channel count and uses explicit danger/warning actions.
- Standard Simplified Chinese, Traditional Chinese, and English descriptions are generated locally from the current layout. QA confirms three non-empty, distinct descriptions containing the current Word mapping, with no network translation call.

## Comparison history

1. Initial findings: oversized hero, dashboard styling, long single page, fixed repository path, redundant naming inputs, and non-editable JSON descriptions. These were replaced with compact Fluent sections, repository selection, single-name derivation, and editable three-language descriptions.
2. User follow-up: the layout still felt crowded and should be the second tab with a Win11 sidebar. The UI was reorganized into three pages with “通道布局” second; six new Electron captures confirmed page switching and responsive fit.
3. Icon polish: the first icon silhouette was too horizontal at taskbar size. It was recomposed as a square 2×2 byte block with three output nodes, flattened to solid colors, given real alpha, and exported to nine PNG sizes plus ICO.
4. User follow-up: the selected-field editor could temporarily exceed its grid track by roughly 5–6px during cold font/layout resolution, while traditional Segoe UI plus global antialiasing made Chinese text look too dark and inconsistent. The editor now owns an explicit `minmax(0,1fr)` track, every child is width/min-width constrained, and the Win11 variable/UI font stack uses regular weights for controls. Final 1306×781 and 980×680 captures show zero local overflow.
5. User follow-up: Word indices and field counts visually concatenated (`01 / 11 / 21`), select arrows looked browser-native, and 32-bit fields appeared as isolated bit cells. The cards now use a distinct index badge and second-line usage, selects use a real Fluent chevron, the table has a dedicated Word column, and every physical `ch` receives a stable pastel color shared by its full region and table badges. Bidirectional hover checks and both viewports pass; `channel-v2-computed.json` records the measured states.
6. User follow-up: selected 32-bit regions still looked fully outlined, confirmations used an unrelated native window, and the channel list needed Word nodes. Selection now emphasizes only the outer region and summary chip; confirmation is an in-app Fluent dialog; output is a collapsible Word→ch tree. `v11-qa.json` confirms 32 selected cells with zero internal outlines, four Word parents, eight Word-0 children, functional collapse, three distinct generated languages, no horizontal overflow, and no console errors.

## Findings

No actionable P0, P1, or P2 design issues remain against the user's final brief. The portable executable is unsigned; that is a release-signing concern rather than a visual-design defect.

## Follow-up polish

- P3: Add a code-signing certificate before public distribution to remove the Windows publisher warning.

## Final result

final result: passed
