# 0.3.9 候选 7 项 · 代码级可行性分析

日期:2026-10-18 · 状态:已完成(示例重构随本分析同步)
范围修正(2026-10-18 大仙拍板):7 项全部**进 0.3.9**,不再排 0.4.0——0.3.9 尚未打 tag,验收收口版定位调整为「验收 + 本批 7 项」。
范围:大仙从 15 项候选中裁留的 7 项(砍掉 02 审批分层 / 04 失败重试 / 06 Variants / 07 ACP / 08 opencode server / 10 出站接入 / 13 死键白名单 / 15 a11y)

结论先行:**没有一项需要从零造**。7 项里 1 项(worktree 管理)已大半落地、4 项有现成宿主或数据源、2 项是脚本/盘点类零运行时代码。示例已按本分析重构(每张 kicker 带 1-7 新序号,角注保留调研表编号)。

## 1. worktree 会话链路(调研表 01)——「已落地大半,补最后一环」

**已有**(重构时从 mock 移除,改标「已有能力」):
- Rust:`src-tauri/src/git/commands_worktree.rs`(145 行)+ `worktree_parse.rs`(262 行,`git worktree list --porcelain` 全字段解析、Windows 盘符互认、prunable 判定)
- UI:`src/plugins/git/worktree/`(618 行):WorktreeManageDialog 列表/新建/移除/清理悬空、可清理标记、分支分组

**0.3.9 真缺口**:会话→worktree 链路
- 会话卡右键「在新 worktree 中起会话」:新建分支 + 复制工作区 + node_modules 符号链接 + 起会话,一次完成
- 会话↔worktree 双向关联徽标(哪个会话在哪个 worktree 跑)
- 磁盘占用列(现有 WorktreeEntry 无此项,需 Rust 侧新增 walkdir 统计)

成本:中。风险:复制策略(全拷 vs COW)跨平台差异。验证:真仓库起双会话互不踩。

## 2. diff 行级批注回传(03)——「渲染全在位,补数据层+回传」

**已有**:词级 diff 渲染(CommitDiffTab/DiffTabContent)、文件 tab 栏、composer 发送链路。

**缺口**:批注数据层(键 = 文件路径 + 行内容哈希,防行号漂移;会话级生存期)+ 回传(批注拼结构化消息走 composer 现有路径)。

成本:低-中。纯前端,零 Rust 改动。验证:批注→回传→agent 收到的消息含批注上下文。

## 3. 限额 reset 可视化(05)——「数据一半在,口径是硬约束」

**已有**:cli-shared/sessionUsage.ts 解析 omp/pi/claude/codex 四家用量行;welcome 凭据/引擎面在位。

**缺口与红线**:窗口语义不在用量行里。claude 5h 滚动窗口可从本窗口首条用量行**推算**;codex 部分可推;grok/kimi 口径未知——按「内核不猜语义」铁律显示 `—`,**不编数**。倒计时纯前端推算,零新增轮询。

成本:低(claude/codex 两卡)。风险:官方改窗口口径即失效,推算逻辑要留一行可改的常量。

## 4. agent wiki(09)——「宿主现成,事件现成」

**已有**:memory-coordinator 插件(capsule/console/install 子模块);`kernel.sessions.exited` 事件已有消费先例(记忆沉淀链)。

**形态**:wiki.json 本地 JSON;wiki = memory-coordinator 新子模块(非新插件);摘录 = 退出时本地截取会话尾部 assistant 消息,**零模型成本**;引擎徽标走 harnessLabel(omp/pi 同源)。

成本:低。风险:截取质量有限——先「人看」不「机读」,标注实验性质。

## 5. 插件懒加载(11)——「46 个全静态是实锤,改法明确」

**实数**:allPlugins 46 插件全静态 import;DesktopApp chunk 3,718KB(gzip 1,136KB)。

**改法**:React.lazy 包 registerTabContent component + activate 两段式(元信息启动时注册,重逻辑首开 tab 才跑)。**红线**:kernel/cli-shared 共享单例必须保持静态;terminal(xterm)常驻首屏不懒;真正可懒 = workbench(19.4k 行)/anim/git 面板/files 预览。Vite manualChunks 配合。

成本:中。风险:懒加载后首次开 tab 的白屏窗(用现有 loading 态盖);回归面大,需要逐 tab 冒烟。预计首包 3,718→~1,600KB(保守,含保守项不减的共享依赖)。

## 6. kernel 分区盘点(12)——「零运行时,脚本+标签」

**实数**:src/kernel 310 文件 29,529 行。

**形态**:scripts/check-kernel-audit.mjs 产「文件×行数×引用方」清单(先例:check-file-size.mjs/check-arch-boundary.mjs);人工贴标签存 scripts/kernel-audit.json 入库;标签「迁出」与 CI arch-boundary 规则联动可检。mock 里四分区数字改为「盘点后回填」占位——**先盘点再定数字,不预填估算**。

成本:低(1 天内含标签)。风险:无。

## 7. WebGL 终端基准(14)——「先测再依赖」

**实数**:@xterm/addon-webgl 未装(仅 fit/search/web-links)。

**形态**:独立 bench 页(不进主包),真实跑 cat 10 万行/htop 模拟/vim 滚动三场景;判定线 = 中位数 fps 差 <5% 无感。**依赖决策后置**:不通过不装;通过也不预装,按持续重绘检测 dynamic import。

成本:低(基准页 1 天)。风险:WebGL context 上限(现有 addon 已处理 fallback)。

## 汇总

| # | 项 | 已有底子 | 新增面 | 成本 | 建议版本内排期 |
|---|---|---------|--------|------|--------------|
| 1 | worktree 会话链路 | 管理面 618 行+Rust 解析全在 | 会话链路+占用统计 | 中 | 先(依赖最重) |
| 2 | diff 批注 | diff 渲染+composer | 数据层+回传 | 低-中 | 先 |
| 3 | quota reset | sessionUsage 四家 | claude/codex 推算 | 低 | 顺带 |
| 4 | agent wiki | memory-coordinator+exited 事件 | 子模块+wiki.json | 低 | 顺带 |
| 5 | 插件懒加载 | —(46 静态是现状) | lazy+两段 activate | 中 | 独立批次(回归面大) |
| 6 | kernel 盘点 | 脚本先例两枚 | 审计脚本+标签 | 低 | 先行(半天,给后续供数据) |
| 7 | WebGL 基准 | — | bench 页 | 低 | 先行(测完才决定依赖) |
