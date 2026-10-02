# 客户端打磨任务2 实施设计(五路审计增量:原生弹窗清零/主题适配/i18n 译文/设置面/微交互)

日期:2026-10-02
状态:已实施(门禁与真机目检注记见文末;审计依据 `docs/research/client-polish-task2-audit.md`)

## 背景与目标

上两轮打磨(65 项 + P0×3/P1×30/P2×45)清掉交互与 i18n 键位大头后,五路新角度审计又捞出 64 项代码级发现 + i18n 译文五类问题。本轮目标:

1. **信任级清零**:原生 confirm/alert/prompt 全仓代码位清零(git 面已实证 Tauri WKWebView 下 confirm 可能不弹窗直接放行);六套新主题下的破相与不可读面修复;cli-config 脏草稿不再静默丢弃。
2. **形制收敛收尾**:弹层键盘回路(Esc/Enter/role)补齐漏网 7 处;设置面原生控件(select/checkbox)归位 StyledSelect/segmented;relTime/日期格式归 kernel 单源。
3. **i18n 从键位到质量**:术语 8 组统一、ja 硬伤清零、插件市场动态键补词典、标点漂移修复。

非目标:不动架构分层与插件边界;不做空态原语/spinner 统一/错误 toast 模板三个机制建设(留观);不做纯增强(市场过滤框、预设网格二级分组与 hover 预览);不翻全角句号(见裁决 R1)。

## 方案取舍

| 方案 | 取舍 | 理由 |
|---|---|---|
| **P0+P1 全修 + P2 精选(选定,用户拍板)** | 信任级与高感知全清,i18n 质量机械批量修,机制建设留观 | P0×6 全是「破坏性操作裸奔/新主题破相/数据静默丢失」级;P1 多为一致性收敛,机械可靠;机制三项各自要建基座+全仓接入,上轮刚立四机制,本轮以清欠账为主 |
| 全量含机制建设(否决) | Empty 原语/spinner 统一/错误 toast 模板一并做 | 三个基座建设使批次体积翻倍,且空态/spinner 现状可用非破相,单独立项性价比更高 |
| 只做 P0(否决) | 仅修信任级 | P1 中弹层键盘回路/数值校验脱节/omp 精选在线语义失真均高感知,弃之可惜 |

## 实施裁决(分域代理的统一约定)

- R1 **UI 词条标点成文**:句号维持全角(259:0 的实践即规范),逗号半角为主——只修 13 条全角逗号漂移与 14 条 "..." 省略号统一为 "…";AGENTS.md 半角规范针对文档,UI 词条惯例按本条成文。
- R2 **原生弹窗收敛目标形制**:confirm → 仓内确认弹层(GitConfirmDialog/ConfirmBubble/DangerAction 两步武装按语境选);prompt → NamePrompt 系输入弹层;alert → toast/内联红字。便签 Esc 弃稿确认一并换仓内形制。
- R3 **主题 token**:写错键名的消费点改正确键(--tmd-bg→--tmd-bg-base、--tmd-surface-1→--tmd-bg-elevated、--tmd-fg-secondary→--tmd-fg-muted、wsfb-search→--tmd-bg-input);语义确有缺位的在 themes.css 补 --tmd-success/--tmd-error(值同 --tmd-ok/--tmd-err 分外观,固定语义色不入映射器)与 --tmd-shadow-popover/--tmd-shadow-modal(按 data-theme 分档,浅色参考 markdown-outline 12-14% 黑档);写死色(#f87171/#f59e0b/#3fb950/#4493f8/蓝 tint/#fff)全部接既有语义 token。
- R4 **确认钮默认词统一「确认」**(GitConfirmDialog/SshOverlay 跟随 ConfirmBubble 现值)。
- R5 **禁用 cursor 约定 not-allowed**:全局基线一处 + 删 default 系局部冲突。
- R6 **relTime/日期单源**:kernel/relativeTime.ts 为唯一实现(补齐 locale 感知单位词),mobile/intent-canvas/web-access 改引;日期格式化收敛 kernel DATE_LOCALES 先例。
- R7 **omp 精选表**:mergeCatalog existing 分支补 curated 合并;精选条目豁免 CATALOG_CAP 并置顶,在线离线同语义。
- R8 **CI**:frontend job 增补 `pnpm check:i18n-keys` 一步,键位防线闭环。
- R9 **深色 ANSI**:dark4.ts 仿 light8 的 LIGHT_ANSI 先例补 16 槽降饱和 DARK_ANSI。
- R10 **i18n 术语统一译法**:幕布=terminal/ターミナル、额度=quota/クォータ、探测=probe/検出、内网=LAN、切换=切り替え、文件夹=フォルダー、工作树=ワークツリー、看板=board/ボード、供应商=プロバイダー、状态=ステータス;「确认更新/检查更新」ja 消歧(確認を確定/更新をチェック)。

## 实施分批(8 域并行,文件所有权互斥)

| 域 | 范围 | 主项 |
|---|---|---|
| A ssh | plugins/ssh/** | prompt/alert/confirm 清零、HostModal 代理端口校验+原生 select×2、SshOverlay role/Esc+确认词、ImportModal/RemoteFileTab |
| B workspace+assets+杂 | 4+2+2 文件 | confirm 清零、弹窗脏态守卫+Esc/Enter/role、原生 select×2、ShortcutTab 武装 |
| C hubs | skill-hub×2/mcp-hub×1 | 弹层 Esc/Enter/role/脏态守卫 |
| D 主题 | themes.css + 20 css + web-access tsx + dark4.ts + BasicAppearanceTab + PluginBoundary | T1-T13、S6、N9/T8、R3/R9 |
| E cli-config+设置 | CliConfigTab/ConfigForm/BehaviorTab/NotifySettingsTab | 草稿拦截、失败反馈持久化、校验域对齐、阈值回落旧值 |
| F omp+CI+批量 a11y | catalog.ts/ci.yml/welcome.css/WallpaperImageRows/44 处 aria-label | N1/N2/N10、M1 附项 |
| G 一致性 | relTime 四源/日期口径/tooltip 双轨/GitConfirmDialog 确认词/cursor 基线 | M4-M8 |
| H i18n | 全部 locales | R1/R10、硬伤 14、动态键 7、笔误 N8、拼接 2 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`,提交前 `npx react-doctor@latest -y` 100 分。
- `grep -rn "window\.\(confirm\|alert\|prompt\)" src/` 代码位清零(注释与测试豁免)。
- 主题:六套 tmd 预设下逐面目检(环形菜单/风险弹窗/泳道名/错误红字/浮层阴影)。
- 真机清单:SSH 主机表单代理端口报错、cli-config raw 模式切引擎拦截、快捷键全部重置两步武装、omp 市场在线精选置顶。
- i18n:check:i18n-keys 退出码 0;en/ja 市场页无中文直显。

## 实施注记(2026-10-02 收口)

- **8 域并行全落地 + 主会话收口**:A ssh / B workspace+assets / C hubs / D 主题 / E cli-config / F omp+CI / G 一致性 / H i18n;公共件先行沉淀 kernel `DialogConfirm.tsx`(ConfirmDialog/InputDialog + 4 例契约测试)供各域消费。P0×6、P1×29 全修;P2 精选(i18n 术语 ~125 词条/硬伤 14/动态键 9/标点 30 键三侧同步/笔误/武装确认/aria-label 批量/深色 ANSI 16 槽/opacity 倒挂/顶层 t() 漏网)全修。
- **原生弹窗清零实绩**:代码位 window.confirm/alert/prompt 0 残留(仅存 7 文件注释);重命名类 prompt → InputDialog,删除/断开/覆盖类 confirm → ConfirmDialog(danger),报错 alert → 内联红字/菜单红字/会话卡消息槽。
- **主题面**:themes.css 两外观段新增 --tmd-success/--tmd-error/--tmd-shadow-popover/--tmd-shadow-modal(固定语义/阴影 token,不入 preset 映射器);写错键名消费点改正确键;21 处浮层阴影按 popover/modal 两档 token 化;dark4 补 DARK_ANSI 降饱和 16 槽(invariants 测试改双签名断言);BasicAppearanceTab is-active 加 custom 前置 + 网格点击同步写 light/darkThemePresetId。
- **收口轮追加修复**(react-doctor 100 攻坚 + 域外残尾):7 个自定义 modal 转原生 `<dialog open>`(assets×2/skill-hub×2/ssh×3,css 侧 UA 定位归零);cli-config 脏态信号改「事件时上报 + 基线上移宿主」消三类 effect 反模式;SftpTree 挂载点 key 化消 prop 反应 effect;HostModal 校验链拆 hostModalValidate.ts 侧车 + AuthCredentials 子组件;BranchRow 删除钮/标题、LocalSection 判定、PromptTab 校验各自抽纯函数降复杂度;并修 A 域引入的 HostModal 保存钮在 form 外点击无效(改 form= 属性关联)、E 域上报的 ssh 缺键、G 域上报的 3 处 cursor:default 残尾与 memory-coordinator 2 处 zh-CN 日期硬编码、intent-canvas 死键 2 条。
- **降档与偏离汇总**:InputDialog 空值禁提交(workspace 别名清空改走侧栏行内重命名);pm-ext-panel 方向性阴影并 token 后丢失左向偏移(可后续加 --tmd-shadow-sheet);mcp-hub ServersView 删除弹层与 skill-hub SkillPreviewDrawer 无 Esc(同类漏网,下轮);en 相对时间从 Intl 长形切 t() 短形("5 min ago");ja 切替→切り替え 等术语统一涉及 ~125 词条值改。
- **门禁终态(2026-10-02)**:typecheck 通过;vitest 447 文件 / 3471 测试全绿;check:arch-boundary / check:file-size / check:i18n-keys(缺键 0、不对称 0,t() 2446 键词典 2870 键)/ pnpm build(2.07s)通过;react-doctor 100/100「No issues found」。CI frontend job 已接 check:i18n-keys。
- **真机目检清单(留大仙)**:SSH 主机表单(Enter 保存/dirty 背板/代理端口红字)、SFTP 右键三弹层、远端文件覆盖确认、cli-config dirty 切换拦截与保存失败持久错误条、快捷键全部重置两步武装、六套 tmd 主题下环形菜单/泳道名/错误红字/浮层阴影、顶栏 data-hint 气泡、omp 市场在线精选置顶。
