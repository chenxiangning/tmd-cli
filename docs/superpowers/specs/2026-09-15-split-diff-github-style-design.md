# 双栏 diff GitHub 风视觉打磨设计

- 日期:2026-09-15
- 状态:已落地(同日)

## 背景与目标

双栏 diff(2026-09-15 凌晨自绘落地)是中央双号槽 + ⤶ 钩 + ⬚ 占位符 + accent 块框的自造视觉体系,信息装饰多、与主流工具观感差距大。目标:纯视觉打磨为 GitHub 风,不动交互模型(单/双栏切换、wrap/nowrap、词级 DP、行高 pin 机制全部保留)。

## 方案取舍

**选定:方案 A 真 GitHub 布局**(大仙拍板)

- 行号槽从中央双号槽移到各半内侧缘:`[旧号 | 左内容 | 新号 | 右内容]`;nowrap 态 3 行栈 → 4 行栈(左号槽|左滚面|右号槽|右滚面),号槽栈不横滚、纵向四面 scrollTop 镜像同步,行高 pin 复用既有机制(左内容栈实测基准 → 其余三栈逐行 pin)。
- 删自造装饰:⤶ 钩、⬚ 占位符、中央槽 accent 括号块框(blockMap/lineCls/frameCls/phClass 及配套 CSS 全清);改动块边界靠色带自然分段。
- 词级标注:下划线 → 实色深染块(color-mix 35% + 2px 圆角,深行底一档)。
- 缺侧留白:灰槽色块 → 对侧种类减半淡染空带(纯删右侧浅红 5%、纯增左侧浅绿 5%,GitHub empty-cell)。
- 行号格:muted、右对齐、tabular-nums、不可选、发丝右线隔内容。

**否决:方案 B 只换肤**(中央槽结构保留,纯 CSS 调色 + 词级实色块)。理由:改动最小但布局仍是自造中央槽,「GitHub 色」而非「GitHub 形」;用户明确选了 GitHub 风,换肤达不到预期观感。

已知风险报备:删块框后改动块范围感变弱;目检(400 行单 hunk 大 patch)块界靠色带分段仍清晰,未回加兜底边线。

## 落地内容

- `SplitDiffView.tsx` 整件重写:SplitGrid 逐行四列 grid;SplitHalves 四栈(双号槽 overflow-hidden + 双内容 overflow-auto);`LineNo` 行号格组件(缺侧空号同色带);`sideBand` 本侧色带/缺侧空带单点判定。
- `git-panel.css` 双栏段重写:band/empty 两档色带、word 实色块、lno 行号格;旧 gutter/block/ph/bd 类全删。
- `PatchLines.test.tsx` 契约换写:GitHub 排布 DOM 序(旧号→左内容→新号)、色带/空带计数、词级实色块、nowrap 四面结构(2 滚动面 + 3 overflow-hidden);块框旧断言删除。

## 验证

- stub 目检(1421 + Tauri 桩):wrap 态 GitHub 排布 + 缺侧空带 + 折行左右同高(修改对 96px 双栈同高);nowrap 态 400 行单 hunk 滚到底 3 位行号零累积错位(历史亚像素 bug 场景)、四面 scrollTop 同步(4×4862)、mod 对词级实色块(oldTail/newTail 深染)截图确认。
- vitest 205 文件 1632 用例全绿;typecheck / arch-boundary / file-size(SplitDiffView 281 行)/ build 全绿。

## 二轮修(同日,目检反馈:两边没对齐 / 中间断层)

- 槽宽对称:`auto` 列轨改 `lnoCols(rows)` 显式列轨(两侧最大行号位数 ch,下限 2 位),左右槽恒同宽 = 内容列镜像对齐;顺带消 content-visibility 离屏行不计宽的槽宽抖动。wrap 态 SplitGrid 一次算全量下传,nowrap 态 SplitHalves 同式。
- 中缝分界:行号格补 border-left(原只有 border-right),双槽双侧发丝线成盒;nowrap 态双 hunk 头在中缝以同款发丝线相接。
- 目检实证:两态四栈宽 [26,217,26,217] 全等,wrap 态 hunk 头通栏单条;1632 用例 / 门禁全绿。
