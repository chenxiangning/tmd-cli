# 界面模块打磨轮四路审计(原语长尾/壳层观感/功能面板观感/密度与交互)

- 日期:2026-10-02
- 状态:已实施(处置与留观见同日 spec;本轮按用户指令不提交,留真机检查)
- 范围:任务1-3 之后的模块级增量;四路只读审计(设计系统原语接入长尾 / 壳层与高频面观感 / 功能面板观感 / 12px 密度风险与交互细节),共 78 项发现
- 性质:能力调研,零代码改动

## 结论先行

系统级规范三轮收口后,剩余欠账分四类:**原语接入长尾**(裸空态约 26 面、裸忙态约 32 处、错误契约违例 6 处——Empty/Spinner 已建但覆盖不到一半);**模块实锤缺陷**(session-board 两个类无样式定义致交互承诺落空、中性规则文案误用红色、git 提交框英文裸奔);**高频观感**(composer 输入框贴边+placeholder 90 字、会话 tab hover 四钮挤爆、双 tab 溢出两种行为、右栏面板切换丢滚动);**交互保命与细节**(会话行 title 不含标题全文、月格状态行截断无 title、~40 处 truncate 无 title、双击强删异类)。

## 一、原语接入长尾(22 项摘要)

- 裸忙态:files 族 9(FileTree/预览四型/markdown 重块)、daily-journal 5、skill-hub 5、mcp-hub 4、kernel 3(FileCodeEditor/TerminalView)、git/ssh/search/cli-config 各 1-2;另有 app-shell 2 处裸 animate-spin 与 omp/ssh-tree 5 处自抄旋转副本。
- 裸空态:右栏 3(ssh/skill-hub/mcp-hub 面板)、中央 tab 5 族、assets/welcome footer/弹层若干;SshPanel 空态主钮违反「空态不给主按钮」。
- 错误契约违例 6:WsfbBodies 搜索失败伪装空态、QuickOpen 红字无重试无 role、McpHubPanel 失败挤计数格、liveOverlay 错误与空态同分流、omp market 灰字、files fvp 族。
- 正面样例(改造范本):SearchOverlayParts(错误红条不进空态)、git HistoryView(持久条+重试)、CheckpointsPanel(空错显式拆分)。

## 二、壳层观感(18 项摘要)

- composer:textarea p-0 左缘与工具栏错位 8-12px;placeholder 一句 90 字;工具栏文本竖线分隔;附件卡文件名不可见;建议列表描述截断无 title。
- 顶栏:会话 tab hover 齐浮 4 钮(view/pin/locate/×)挤爆标题且与右键菜单割裂;双 tab 溢出一挤压一横滚无指示;编辑 tab 双钮(最大化/关闭)不分级。
- 设置:外观卡混装「会话标题 tab 条」;tab 条不吸附。
- 欢迎页:提示行 nowrap 常驻抢首屏;GitHub 链接占标题条;行展开瞬跳;720px 凭据列消失致 ● 入口不可达;footer 两空态纯文字。
- 右栏:files 面板无标题带,与 git 面板形态不一。
- 侧栏:行内齿轮与右键菜单功能重叠、24px 常驻让位挤标题(留观)。

## 三、功能面板观感(18 项摘要)

- git:提交框四处英文裸奔(`commit ▸`/`[x] --amend`/`{n} selected`/`⌘⏎ commit`);树形目录行 CaretDown 误导(不可折叠);树/平铺状态徽标两形制;检出钮与行首图标同形双现;历史行头像 12px 过小;工具栏 icon 钮无分隔、命中区 20px;聚合行数连读;分支新建钮 caret 语义错位;双击=强删确认(全仓唯一危险动作绑双击)。
- checkpoints:批头一行 7 类信息无截断优先级;审阅单标题行无层级;元信息三形制并存(chip/mono/裸文字)。
- session-board(实锤):`.sb-card.hl`/`.sb-card.live`/`.sb-kb` 三类 css 无定义——点节律条高亮零反馈、键盘提示以正文色抢层级;规则条中性说明用红色常驻。
- daily-journal:技术 profileId 直出阅读面。
- hubs:安装钮两 hub 权重不一(ghost vs accent)。
- 转录:工具行状态符落定/活轮两宽度(结算微跳);path 副行收起态恒占两行。

## 四、密度与交互(20 项摘要)

- 12px 迁移后真截字容器 0;贴边微容器 4(sb-seg-lbl 11px 行盒溢出、origin-badge 14px、file-mode-toggle 18px、markdown-outline 18px 行高);月格 minmax 满格 ≈108px<128px 安全。
- truncate 全仓 133 处,40+ 无 title(会话行 title 是固定恢复文案不含标题全文、月格状态行必截无 title、git/checkpoints/mcp-hub/search 长尾)。
- 交互:右栏 filePanel 三元切换与 git/checkpoints 面板内视图切换互卸载丢滚动;FlowView 折叠态切面板重置;键盘导航 7 处支持 vs 大列表零覆盖(留观);双击强删异类;年视图 9 类状态色无图例;mgrid 列轨窄窗横滚。

## 处置

见同日 spec `docs/superpowers/specs/2026-10-02-polish-task4-module-refine-design.md`:原语长尾全收(约 50 面)、实锤 4 项全修、P1 观感/保命 11 项全修、P2 精选 ~25 项;大列表键盘导航/右键菜单补全/titlebar Windows 截断收纳/侧栏齿轮重构留观。附件「全部清除」store 疑点核实为误报(函数式更新已正确处理)。
