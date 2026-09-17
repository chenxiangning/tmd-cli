# 双栏 diff 折叠焦点设计(全文态 context 压缩)

- 日期:2026-09-18
- 状态:已落地(同日,commit c126047;评审收口随本文)

## 背景与目标

git 双栏 diff 方向探索(2026-09-16,六方案 N1-N5 + V2 基准)中,N4「折叠焦点」经原型评审通过:密度轴动刀——连续 context 段(≥3 行)默认压成胶囊条(`··· N 行未改动 + 双侧行号区间 + 展开`),点击就地展开,改动块永远展开;首屏视野里只有「变了什么」。目标场景是全文查看(整文件 patch,上下文段多)。

## 方案取舍

**选定:折叠只作用于「双栏 + 全文态」,作为既有全文 toggle 的属性**

- `fold={fullView}` 自 PatchLines 透传(CommitDiffTab / DiffTabContent),折叠是 fullView 的渲染属性而非第三个开关——原型注记「落地时两者要合并语义,不能并存两个开关」的忠实解读:全文/上下文 toggle 维持管拉取,胶囊管就地展开,一个轴。
- 默认上下文态零改动:本地三行 context 就是评审窗口,再折叠反而伤评审。
- 规划在纯逻辑层(patchModel `planFolds`/`foldItems`,键 = 双侧起号,跨 wrap 翻转与同内容重拉稳定),交互件独立(splitFold:胶囊按钮 + 展开态钩,段集换代渲染期派生复位,无 effect)。

**否决:统一态(unified)也折叠**。需另起一套 unified 行规划器,而原型本身是双栏专属(胶囊区间展示双侧行号),收益不抵双规划器维护,有意收窄并留注释。

**否决:全局「上下文」开关替代逐段胶囊**。全局展开/收起丢掉「逐段就地」的核心交互;且与全文拉取开关语义纠缠,正是原型警告的并存两开关。

已知代价(原型列明,接受):折叠时行号跳跃,看上下文需多点一次;胶囊条常驻(展开态 label 翻转「收起」),非原型的一次性展开。

## 落地内容

- `patchModel.ts`:pairKind 自视图层下沉;`planFolds`(连续 ctx pair ≥3 记段)+ `foldItems`(段恒出胶囊项,展开时原行紧随摊平)。
- `splitFold.tsx`(新):FoldBar 胶囊(aria-expanded,halves 态右栈实例 ghost 化 aria-hidden + tabIndex=-1 防读屏冗余)+ useFoldRuns 展开态(sig 换代整组复位)。
- `splitCls.ts` / `splitCells.tsx`(新拆件,300 行铁则切面):类名表 / 共享格件(WordContent、LineNo、GridPairRow、useWordParts)。
- `SplitDiffView.tsx`:两渲染器接入 items 编排;nowrap 态滚动面挂 container-type,胶囊宽度 `min(栈宽, 可视宽)` 防横滚裁 label。
- `git-panel.css`:`.git-split-fold` 系列(token 与既有淡染同源);en/ja 词典补「行未改动」。

## 验证

- vitest:patchModel 折叠规划 2 例 + PatchLines 渲染契约 1 例(缺省不折/改动块恒展开);git 域 58 例、全量 1655 全绿;typecheck / file-size / arch-boundary / build / react-doctor 100 全绿。
- 桩目检(1421 + Tauri 桩,浅色主题)四态:上下文态 0 胶囊;全文态 3 胶囊(行号区间双侧正确);就地展开/收起条常驻;nowrap 四栈逐行 0px 偏差;强推 3000px 内容栈胶囊恒收敛可视宽;识图抽查无破版。
- 评审收口(UX 路):合并语义判定忠实原型;F1 本 spec 补盘即本文;F2 双胶囊读屏冗余已修(右栈 ghost);F3 暗色对比系全仓既有约定留档;F4 单复数文案构造上不可达(FOLD_MIN=3)。
- 评审收口(正确性路):F1 pairKind 改同源判定(===)——del×add zip 撞出的同文对(补尾换行)不再误判 ctx 入段,唯一改动不被折叠藏住,回归用例锁定;F2 CommitDiffTab 的 PatchLines 按 selected 重挂,同签名文件间展开态不泄漏。F3 词标注随 toggle 重跑亚毫秒级留档不修。
