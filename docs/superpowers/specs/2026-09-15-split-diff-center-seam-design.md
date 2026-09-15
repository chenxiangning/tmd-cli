# 双栏 diff 中缝连接带视觉迭代设计

- 日期:2026-09-15
- 状态:已落地(同日)

## 背景与目标

同日早些时候的 GitHub 风重做(spec:2026-09-15-split-diff-github-style-design.md)落地后,大仙给出 Trae/JetBrains 风双栏 diff 参考图(7 张,深色主题),要求继续向该观感迭代。目标仍锁定纯视觉:不动交互模型(单/双栏切换、wrap/nowrap、词级 DP、行高 pin、纵同步全部保留)。

参考图核心观感:行号槽居中缝两侧、改动块的色带贯通中缝形成左右相连的整体横带、槽线在改动块处被打断。

## 方案取舍

**选定:中缝连接带(JetBrains 形,大仙拍板)**

- 列序翻转:`[旧号 | 左内容 | 新号 | 右内容]` → `[左内容 | 旧号 | 新号 | 右内容]`,双号槽相邻居中。`lnoCols` 列轨改 `minmax(0,1fr) w w minmax(0,1fr)`;nowrap 四栈重排 `[左滚面 | 左槽 | 右槽 | 右滚面]`,scrollTop 镜像与行高 pin 机制原样复用。
- 中缝连接带:号格发丝从「border-left + border-right 双侧成盒」改为只留 border-right 单发丝(旧号右缘 = 中缝,新号右缘 = 号/内容分界);改动行(mod/del/add)双号格发丝透明,两侧色带在中缝相接成一条贯通横带——即参考图「连接器打断槽线」的观感。
- 色带仍按侧着色(mod 对左红右绿;纯删右侧 5% 浅红空带、纯增左侧 5% 浅绿空带),色在中缝自然过渡。
- 词级实色块(35%)原样保留。

**否决:斜面漏斗连接器**。参考图里左右块间的斜面连接是「两侧独立行流 + 差异块对齐」布局的产物;本实现是 zip 配对布局(缺侧以空带补齐),两侧恒同高同垂直位,斜面物理上不存在,连接带只能是平直横带。已在选型时向大仙报备。

**否决:应用/回退箭头 gutter 按钮**。参考图 gutter 的 »/«/↩ 是把一侧改动应用到对侧的交互功能,超出纯视觉范畴,大仙选型时排除。

**不做:当前行高亮**。参考图的跨栏高亮行是编辑器光标行;本 diff 是只读视图,无光标概念,YAGNI。

已知边界:连接带平直(见上);色带强度沿用 12%/5%/35% 档位,目检对照参考图后如需调档另起小迭代。

## 落地内容

- `SplitDiffView.tsx`:列轨与子序翻转(wrap 态 GridPairRow 四格重排;nowrap 态 SplitHalves 四栈重排);`LineNo` 增 seam 态(改动行附加 `git-split-lno-seam` 类,判定复用 pairKind)。
- `git-panel.css`:`.git-split-lno` 双发丝改 border-right 单发丝;新增 `.git-split-lno-seam` 发丝透明规则。
- `PatchLines.test.tsx`:split 排布断言换写为「左内容 → 旧号 → 新号 → 右内容」DOM 序 + seam 类计数;其余契约(色带/空带/词级/nowrap 结构)不动。

## 验证

- 桩目检(1421 + Tauri 桩,浅色主题):wrap 态中缝贯通横带 + 号格居中缝两侧;nowrap 态四栈重排后纵同步/行高 pin 不回归(400 行单 hunk 滚到底零错位)。
- vitest 全绿(含换写断言);typecheck / arch-boundary / file-size / build / react-doctor 100 全绿。
