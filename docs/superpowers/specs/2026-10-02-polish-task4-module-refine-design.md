# 界面模块打磨轮实施设计(原语长尾收尾 + 模块级精修)

日期:2026-10-02
状态:已实施(门禁全绿;按用户指令**未提交**,留真机检查;审计依据 `docs/research/client-polish-task4-module-audit.md`)

## 背景与目标

任务1-3 收掉交互缺陷、主题适配、设计系统 token 与原语后,四路模块级审计发现:原语(Empty/Spinner/错误契约)覆盖不足一半(裸空态 26 面/裸忙态 32 处/契约违例 6 处);另有模块实锤缺陷 4 项与高频观感/交互保命欠账。本轮目标:原语长尾一次收齐、实锤清零、高频观感与保命项全修、P2 精选跟进。

非目标:大列表键盘导航(roving)与右键菜单补全(工程量大,单独立项);titlebar Windows 窄窗截断收纳(平台特定);侧栏行内齿轮重构(交互面大改);右栏整栏收起跨收保活(需重构面板条件挂载)。

## 方案取舍

| 方案 | 取舍 | 理由 |
|---|---|---|
| **原语长尾全收+模块精修(选定,用户预授权)** | 8 域并行(files+search/hubs+omp/git/审批+看板/composer+welcome/日志+转录/壳层/设置) | 长尾是上一轮建制的自然收尾,不做则设计系统「建而不全」;模块精修项全部有审计实据 |
| 只做实锤+P1(否决) | P2 中 title 补齐/视图保活等日常可感 | P2 工程量小收益直接,弃之可惜 |
| 含键盘导航/右键补全(否决) | 大列表 roving + 菜单族 | 每项都是独立特性级工程,混入打磨轮膨胀风险大 |

## 实施裁决

- R1 原语接入纪律:忙态一律 `@kernel/Spinner`(可带说明文字);空态 `@kernel/Empty`(动作钮次级边框形,错误态不进空态形制);可重试取数失败=持久条 role=alert+重试;lv-spin/ss-spin 九点阵维持声明豁免。
- R2 视图保活:面板内视图切换(git 三视图/checkpoints 双视图)与右栏面板切换(DesktopColumns)统一「全挂载+display:none+aria-hidden」(EditorCenter keepAlive 同律);未访问面板不预挂(latched 渐进);各面板后台轮询保持(数据回切即新鲜,评估记实施注记)。
- R3 会话 tab 收敛:行内 hover 只留 ×;view/pin/locate 收进右键菜单(带可用性门控);置顶常亮指示保留。
- R4 双 tab 溢出:统一横向滚动+右缘 16px mask 渐隐;会话 tab 不再挤压收窄。
- R5 双击强删改两击武装(DangerAction 先例),移除 onDoubleClick 暗道。
- R6 截断补 title 批量(git/checkpoints/mcp-hub/search/daily-journal);会话行 title 含标题全文;月格状态行 title={line}。
- R7 错误/空态分流:WsfbBodies/QuickOpen/McpHubPanel/liveOverlay/omp market 五处错误改持久条;空态归 Empty。

## 实施注记(收口)

- **8 域全落地**:D1 files+search(9 忙态+错误契约+QuickOpen 三态+3 空态);D2 hubs+omp(面板三态/两 hub 安装钮统一 accent 描边款/omp 旋转副本清零/空态含「编辑配置」「打开技能商店」深链 action);D3 git(提交框 t() 化 4 词条、三视图保活、双击强删改两击、DiffView caret 去误导+徽标统一、头像 14px、9 处 title、工具栏分隔+命中区、4 空态);D4 审批+看板(sb-card.hl/live/sb-kb 三类补定义、规则条去红、双视图保活、批头引擎·模型收 title、审阅单层级+元信息统一 mono、路径 title);D5 composer+welcome(textarea pl-2 对齐+ghost 同步、placeholder 精简为一句、竖线分隔改色块、附件卡文件名、建议描述 title、提示行降弱+省略、GitHub 收页脚、行展开 120ms grid-rows 过渡、720px 凭据列保 ● 圆点、footer 两空态接 Empty);D6 日志+转录(5 忙态+TaskPanel 空态、月格 title 三处、FlowView 折叠态模块级 store(切面板不重置)、mgrid 列轨 minmax(min(128px,1fr)) 防横滚、年视图角部图例(9 色归并 5 类)、liveOverlay 错误 sticky 持久条+可复活、sv-tool-mark 定宽、path 副行仅展开态);D7 壳层(会话 tab 钮收敛+右键菜单三项、双 tab 溢出统一+mask、双钮分级、两处 animate-spin 换 Spinner、右栏 latched 保活、files 面板标题带);D8 设置+微容器(会话 tab 条拆独立卡、settings-tabs sticky 吸附、3 处微容器修值、MemoryPanel Spinner、控制台空态 Empty)。
- **收口清理**:file-tree-loading-spinner/omp-ext-spin 两处死 css 删除;附件「全部清除」疑点核实误报。
- **新词条**:git2 +4(提交 ▸/追加修正(--amend)/已选 {selected}/⌘⏎ 提交)、git 换 2(删除钮两击)、composer placeholder ±2、dj +5(扫描/读取中/图例)、sv +1(重试)、skill-hub +1(打开技能商店)、cli-omp 新建插件词典 +2;其余全部复用既有键。
- **门禁终态**:typecheck 过;vitest 450 文件/3482 测试全绿;arch-boundary/file-size/i18n-keys(缺键 0)/build(2.27s)/react-doctor 100/100 全过。**未提交**(用户指令,工作树 106 文件留检)。
- **留观(下轮候选)**:大列表键盘导航 roving;面板右键菜单补全;titlebar Windows 窄窗截断收纳;侧栏行内齿轮与右键菜单收敛;右栏整栏收起跨收保活;激活 tab 自动滚入视野;远程文件树(FileTreeRemoteSource)面板头;checkpoints 时间线保活态的 2s 轮询显式停表;kernel locales 死键清扫(「批次 #{index} · {state} · {time}」等)。
- **真机目检清单(留大仙)**:composer 输入框左缘对齐与 ghost 重合、会话 tab 右键菜单三项与行内只剩 ×、双 tab 横滚+右缘渐隐手感、右栏 git↔files↔日志切换不丢滚动、files 面板标题带、看板点节律条卡片高亮与键盘提示弱化、审批批头/审阅单新层级、git 提交框中文案、删除钮两击武装 3s 回退、日志 Spinner 与年视图角部图例、liveOverlay 错误条重试、月格窄窗、设置 tab 吸附与会话 tab 条独立卡。
