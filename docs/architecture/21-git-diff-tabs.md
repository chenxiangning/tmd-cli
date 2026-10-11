# 21 — git diff 中央 tab 契约:一仓一侧一 tab + 左列变更清单 + 单双栏渲染同源

日期:2026-10-10
状态:生效中(改 git diff tab / PatchLines 渲染前必读)

## 背景

工作区 diff tab 原为「一文件一侧一 tab」(`git-diff:<s|w>:<path>`),与提交 diff tab
(一提交一 tab + 左列文件清单)两套形态并存,查看态不统一。2026-10-10 大仙拍板:
以提交 diff tab 为标准,工作区 diff 必须有独立左侧变更列表;单/双栏信息对比
展示同源打磨。

## 契约

### tab 锚定(diffTab.ts)

- tab id = `git-diff:<s|w>:<cwd>`:一仓一侧一 tab;payload = `{ cwd, staged, focusPath? }`。
- `openDiffTab` 走 `openTab(..., { refresh: true })`:重复点文件 = 聚焦 + 刷 focusPath
  深链(与 commitTab 同语义);tab 内切文件不回头改 payload。
- 选侧规则不变:staged=true 仅当「已暂存且工作区无叠加改动」(wt 优先)。
- tab 标签:kind 注册图标(GitDiff)在 → tab bar 显 title(`<仓名> — 工作区 diff` /
  `<仓名> — 暂存区 diff`,多仓可区分),`path` 字段 = 仓根,作悬浮定位。

### DiffTabContent 结构(与 CommitDiffTab 同构)

- 头:侧标签(工作区 → 暂存区 / 已暂存 → HEAD)+ 仓根 + `{n} 文件` + DiffModeToggle
  (全文/单双栏/自动换行)。
- 左列清单:`useGitStatus(cwd)` 5s 轮询(与右栏面板同 hook,幕布改盘自动跟进),
  按侧过滤(`staged ? f.staged : f.wt`);± 行数来自 `useGitTotals`(低频命令,
  按 staged 侧别配对)。
- 选中文件:用户点选 ?? payload.focusPath 深链;仓/侧/深链换代作废旧点选(带 key
  比对);清单到位后选中失效(被暂存/还原)渲染期回落首个 —— 全部派生,无同步 effect。
- patch:`gitDiffFilePatch(cwd, selected, staged, full)` 按需单文件拉,token 防竞态,
  不做缓存;切文件复位 fullView。useGitStatus 轮询数据身份换代(值等守卫后 = 仓状态
  真变)即对所选文件**静默重拉**(不动 loading 旗,旧 patch 留屏防闪)——tab 常驻后
  「幕布改盘、重开即新鲜」由轮询继承。

### 单/双栏渲染同源(PatchLines)

- **词级标注**:单栏 mod 对(del 块 × add 块 zip 配对)与双栏共用
  `buildSplitRows` 配对 + `wordDiff` DP,实色深染块(git-split-word-ins/del)。
- **未改动段折叠**:全文态(fold=true)连续 ctx 段 ≥3 行整体隐去(无就地胶囊,
  2026-10-10 起);展开入口在头部工具条「展开/折叠未改动」(DiffModeToggle,
  countFoldRuns 判按钮可见性),展开态 = fold 传 false 原样全渲染。规划
  planFolds/planUnifiedFolds,渲染层只做 visibleSplitRows/visiblePatchRows 过滤,
  同一下限 FOLD_MIN=3。
- **语法上色**:PatchLines 收 `path` → kernel `prismLangOf` 解析 Prism 语言,
  正文格经 `highlightLine`(LRU 缓存)注入 token span;配色走全局
  `styles/syntax-tokens.css`(.token.* → --tmd-syntax-*,与 markdown 代码块/
  CodeMirror 同板)。lang 解析不出 = 纯转义不上色。
- 双栏其余视觉规范(独立横滚 / 变更描边 / 中缝连接带)见
  `docs/superpowers/specs/2026-09-15-*` 与 SplitDiffView 头注,不变。

## 验证

- 契约测试:splitCls.test.ts(openDiffTab 锚定/refresh/拒收)、patchModel.test.ts
  (planUnifiedFolds/visiblePatchRows/visibleSplitRows/countFoldRuns)、
  PatchLines.test.tsx(单栏词级块 + 折叠隐匿 + Prism token)。
- 桩目检(1421 + __TAURI_INTERNALS__ 桩):工作区 tab 左清单按侧过滤 ± 配对、
  深链选中、切文件重拉、头部「展开/折叠未改动」开关、双栏切换、语法色渲染。
