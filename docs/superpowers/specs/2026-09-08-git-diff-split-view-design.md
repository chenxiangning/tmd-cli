# Git 文件 diff 单栏/双栏视图设计

- 日期:2026-09-08
- 状态:已落地(2026-09-08 验收提交;裁决:仅中央两个 tab / 默认单栏 / 全局落盘)

## 背景与目标

git 插件的文件 diff(中央「工作区 diff」tab 与「提交 diff」tab)目前只有 unified 单栏渲染(`PatchLines.tsx`),无行号,长串删除+新增挤在一起时难以对应新旧行。参考 codemoss(`src/features/git/components/DiffBlock.tsx` + `src/utils/diff.ts`)的成熟实现,重新设计为:

1. 单栏(unified):保留现状布局,补旧/新双列行号槽。
2. 双栏(split):左旧右新并排列,del 块与紧随的 add 块按下标配对,余量侧斜纹占位。
3. tab 头部 segmented 切换,选择全局落盘(`settings.json` git 域),默认单栏。

## 方案取舍

| 决策点 | 选定 | 否决 | 理由 |
|---|---|---|---|
| 行号来源 | 解析 unified patch 的 `@@ -a,b +c,d @@` 头播种行号计数(codemoss `parseDiff` 同构) | 调 LCS 重算双文件全量 diff(codemoss `computeDiff`) | 现有 IPC 只给 patch 文本不给双文件全文;解析头零新增 IPC,LCS 只在其 patch 缺失时才有意义 |
| 双栏对齐 | 单滚动容器内逐行 `grid grid-cols-2`,行高 = 两侧 max | codemoss 式左右两个独立 pane div | 单 grid 在内容换行时左右行高自动对齐,少一层同步负担;滚动条只有一根 |
| 切换状态 | `settings.json` git 域新增 `diffMode`(`git.view`/`git.layout` 同模式),panelStore setter 唯一写入口 | 每 tab 会话内记忆 / localStorage 私钥 | 用户裁决「全局落盘」;git 域持久化先例已成熟,零新增基建 |
| 切换范围 | 仅 DiffTabContent + CommitDiffTab 两个中央 tab | 弹窗内嵌 CommitDetailsPanel/WorktreeDiffPanel 也加 | 用户裁决;弹窗栏宽窄,双栏挤;PatchLines 收 `mode` prop,日后要扩只传参 |
| 解析产物 | `patchModel.ts` 纯逻辑文件(parsePatch + buildSplitRows),PatchLines 只渲染 | 全部塞 PatchLines.tsx | 300 行铁则余量 + 纯函数可测 |
| 内容行文本 | 解析期剥掉 `+`/`-`/`空格` 前缀,语义由行号槽与底色承担 | 保留前缀字符 | 与 codemoss/VS Code 一致;双栏模式下前缀字符纯属噪音 |
| 空侧占位 | CSS 斜纹(`git-panel.css` 新增一条类,`--tmd-*` token) | 灰底纯色 | 对齐参考图 2 视觉契约,明暗主题自动适配 |

## 追加:全文查看(2026-09-08 同批落地)

- **需求**:除 hunk 视角外,支持查看整文件内容(变更行内联高亮),默认关、
  单文件维度、换文件需重新点开。
- **方案**:Rust 侧 `git_diff_file_patch` / `git_commit_file_patch` 加 `full: bool`,
  `true` 时 `DiffOptions::context_lines(u32::MAX)`(整文件单 hunk;git2 原生能力,
  无需自建 LCS);前端两个中央 diff tab 各持 `fullView` 本地 useState(DiffTab 按
  文件锚定 key 重挂载天然复位;CommitDiffTab 切文件 onClick 显式复位),切换即
  按原通道重拉 patch,渲染完全复用 PatchLines(单/双栏模式继续生效)。
  被否方案:前端拿全文自建 LCS 重算(codemoss 老路,MAX_LCS_PRODUCT 截断 +
  大文件卡顿,而 git2 上下文参数零成本);全文状态落盘(违背「换文件重开」语义)。
- **代价**:patch 体积 ≈ 文件本身,用户显式点开才触发;二进制 patch 走既有
  短路分支不受影响。弹窗内嵌 diff(CommitDetailsPanel / WorktreeDiffPanel)
  恒 `full=false`,行为不变。

## 验证

- `parsePatch`/`buildSplitRows` 单测:行号计数、del/add 配对、余量留空、hunk/meta 头行、无 `@@` 的 meta 兜底(原计划的 patchLines.test.ts 落地时拆为 patchModel.test.ts + PatchLines.test.tsx 两文件)。
- `settings.fields.test.ts`/`settings.test.ts` 的 git 域形状钉更新(diffMode 进默认与白名单 sanitize)。
- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
- 浏览器桩(1421 + `__TAURI_INTERNALS__` 桩 git_status/git_diff_file_patch)目检:单栏带行号、双栏配对与斜纹、切换写盘重启保留。
- 已验收(2026-09-08):前后端全链验证与桩目检通过,随本分支提交。
