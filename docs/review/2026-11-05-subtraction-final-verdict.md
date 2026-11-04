# 减法批次(A～I)整批变更终验收口报告

日期:2026-11-05 · 分支:tmd-0.4.9 · 终验提交:80fc2e64(修复)+ 38f0bd3e(I 决策)

## 结论

§11 最终收口清单 4 节 32 项核验完成:**31 项通过,1 项异常需产品拍板**(右 rail 默认动作数),异常不阻塞已落地功能的正确性。发现的 3 处文档/残留问题已当批修复并复验全绿。

## 11.1 信息架构(8 项:7 通过,1 拍板)

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 左 rail 4 项 | 通过(注 1) | 注册面仅 workbench(10)/home(20)/anim(45)/workspace(50)/设置底钮;LeftRail.tsx 壳注释已修正 |
| 学堂不常驻左栏、搜索单一入口 | 通过 | academy 无 leftRail/section 贡献(A-03),欢迎页帮助区 + academy.open 命令承接;search SearchHubEntry order -1 唯一 |
| 新装默认右 rail 5 面板 + 2 动作 | **异常待拍板**(注 2) | 5 面板 ✓(远程/处理/文件/Git/AI 配置);动作实测 4 个(终端/代理/端口/意图画布) |
| 设置 7 导航组、旧深链可用 | 通过 | SETTINGS_NAV_GROUPS 7 组;section id 未变(F 批次评审已验) |
| 工作台主 tab 5 个、回顾三视图 | 通过 | reviewTabs.test.ts「主 tab 仍 5 个」守;journal id 保留显示名「回顾」 |
| 搜索一套壳、三命令与 ⌘L 不混 | 通过 | D-03 共壳(session-search 原壳仅 search 禁用时注册);⌘L = composer 输入历史抽屉,独立命令 |
| RPC 会话新建菜单可达、无隐式互切 | 通过 | structured-session contribute workspace.newSessionMenu order 21;右 rail 无直挂 |
| 无死展示/死按钮/死快捷键/死设置 | 通过 | 「建设中」全文零命中;session-board/footprint 目录级残留清零;tab kind 契约测试守 |

- 注 1:动画项目(anim)为 H 回滚后用户裁决保留的左 rail 条目,属 4 项之外的合法增项。
- 注 2:目标「2 动作」要求 ports、intent-canvas 随可选化移出默认钉住;H 批次(默认停用方向)被用户否决回滚,两插件回归默认启用,其 rail 默认钉住从未摘除。**当前默认 = 5 面板 + 4 动作**。拍板选项:(a)维持现状(用户常用,常显合理);(b)改 defaultPinned:false(插件照常启用,右 rail 收入 ⋯ 菜单,⌘⌥I/中央 tab 入口不变)。按「需产品确认」硬闸门未自决。

## 11.2 生命周期与数据(5 项全过)

- 单一责任宿主:archiveExitedSession 唯一装配(workspace/index.tsx:261);activateRollup 唯一(footprintRuntime);bootApprovalInbox 唯一(approval-inbox activate);身份/存证/转录深链有 G-02 回归测试。
- 无重复装配:attachAutoDistill/attachWikiStore 仅 memory-coordinator/index.tsx:41-42 一处;workbench journal/docgen 无第二装配点。
- 移除能力零残留:无残留轮询/OS 通知/Composer 注入(「建设中」、@plugins/session-board、@plugins/footprint import 全文零命中)。
- 数据可读:持久化合并/迁移测试随门禁全量通过;不删用户数据口径未破。
- 老用户钉住清单:filePanel persisted 优先 + pinOnce 一次性补钉;恢复精简布局(LayoutResetCard)显式确认后才重置,零无声覆盖。

## 11.3 核心回归(11 项全过)

- `pnpm check:gate` 全绿(file-size / arch-boundary / i18n-keys / kernel-audit / typecheck / test / build,28s)。
- `npx react-doctor@latest -y` = 100/100。
- Rust 三件套:`cargo fmt --check` ✓、`cargo clippy --all-targets -- -D warnings` ✓、`cargo test` ✓(G 批次 proc PATH 富化无回归)。
- 深链冒烟:RpcEntry 新建菜单、footprint.daily 旧 kind 兼容、设置 section 深链、预设双向深链均有契约测试随门禁执行。

## 11.4 工程证据(6 项:5 通过,1 项如实降级)

- 门禁/doctor/Rust 证据:本报告 §11.3,逐批评审记录见 docs/README.md 索引(A～F、H 回滚、I 决策)。
- 残留扫描:词典对称(i18n-keys 机器把关)、快捷键、图标装饰、tab kind、localStorage、import 残留——「建设中」/旧插件 import 零命中,空 footprint 目录(.DS_Store)已清。
- 包体前后对比(减法前 51a01ba6 → 现 HEAD):

| 指标 | 前 | 后 | Δ |
| --- | --- | --- | --- |
| 入口 index-*.js | 662,971 B | 663,040 B | +69 B |
| dist 全量 | 22,148 KB | 22,172 KB | +24 KB |
| 全部 JS gzip 合计 | 5,956,198 B | 5,962,087 B | +5.9 KB |

  结论:本轮减法是**入口与信息架构收减,非包体瘦身**——重 chunk 域(Office 预览/xlsx/pdf/excalidraw/mermaid/katex)经 I 裁决全部保留,H 回滚又恢复三插件,包体持平在预期内。
- 五条主任务路径:新建会话/处理 Ask/审阅变更/找到某日工作/修改 AI 配置的入口步数对比已分散在 A～F 批次评审记录(D-01/E-01/F-01 等);**量化计时对比未做**,随真机目检一并补(见下)。
- FEATURES.md 同步:已补 2026-11-05 终验补校注记并修订 7 处失准正文(chrome 取消静默化、会话看板/footprint 并入、学堂入口、审批兜底语义、市场入口与占位删除、插件计数 48→46、左缘 rail 顶簇);提交 80fc2e64。
- 真机目检:多批评审记录标注「真机目检待办」,汇总待办 = 新装默认右 rail 观感、恢复精简布局确认流、远程落地页、设置七组导航、回顾二级视图、RPC 新建入口。

## 异常与修复清单

| 级别 | 项 | 处置 |
| --- | --- | --- |
| 拍板项 | 右 rail 默认动作 4 vs 目标 2(ports/意图画布) | 未自决,待用户选(a)维持/(b)默认不钉 |
| 已修 | FEATURES.md 7 处失准正文 + 补校注记 | 80fc2e64 |
| 已修 | LeftRail.tsx 壳注释残留「会话看板 40」 | 80fc2e64 |
| 已修 | src/plugins/footprint 空目录(.DS_Store) | 80fc2e64 清除 |

## 附:提交链(减法全周期)

f0870d89(A)→ B/C/D/E/F(各批收口)→ e3184326(RPC 渲染层打磨)→ 50f3dc19(proc PATH 富化)→ f1f32bec(H)→ 9ee36914(H 回滚)→ 38f0bd3e(I 决策)→ 80fc2e64(终验收口)。
