# 2026-11-04 减法批次 E 代码评审(3ead428f)

结论:E-01~E-05 五项全部落地合规,无 P0/P1/P2;当轮修 1 处 P3(marks 会话组注释陈旧)。全链 gate(625 文件/4805 测试)+ react-doctor 100 绿。真机目检(AI 配置首页五卡直达/返回链/预设弹层开提示词库/控制台高级折叠)与 A~D 批共用一次目检窗口。

评审对象:`3ead428f refactor(subtraction): 批次E收口` 28 文件 +655/-160;对照 implementation.md §6(E-01~E-05)逐条验收。工作区净,分支 tmd-0.4.9 ahead 8(评审修复后 9)未推送。

## ① 功能实现准确性 / 架构契合度

- **E-01**:AiConfigHome 只导航不复制表单(计划原文);导航定义收敛 aiConfigNav 纯逻辑(组件文件不导出非组件铁则),契约测试钉死五卡直达调用面——引擎/智能体走 `openSettingsPanel({section:"cli-config",tab:"engines"} / {section:"assets",tab:"agents"})`,Skills/MCP 走 hubTab 幂等 open,Magic Context 走 openConsoleTab;深链 id 与两家 registerSettingsSection 实际声明逐一对上(engines/agents/prompts)。禁用矩阵正确:目标插件停用仅对应卡 disabled + 统一原因,宿主自身能力(Magic Context/记忆与规则)永不禁用(面板在即插件在)。MemoryFilesView 拆出为逐行搬移(探测/生成逻辑零漂移),且探测从面板打开即跑改为进文件视图才跑(惰性,性能小增益)。
- **E-02**:四插件声明面 `pinnedByDefault:false`(memory/skill-hub/mcp-hub/marks),marks 撤 pinOnce;memory-files 保持默认钉。契约测试三段:显式 false / memory-files 钉+无 pinOnce / centerTab open 联动不丢。kernel pinOnce 机制原样(只撤声明,autopin 历史标记不清,合计划)。
- **E-03**:cli-config/assets 设置 tab 顶部 AiConfigBackLink 回链,guard 正确(memory-files 未注册 → 不渲染死链);section id/tab id/title 全不变,仅 description 前缀「AI 配置的××子能力」;跨插件叶子 import 双向(cli-config/assets→AiConfigBackLink、memory-coordinator→hubTab×2)均无环。
- **E-04**:PresetFormCard 唯一消费方 SessionPresetsDialog 注入 onOpenPromptLibrary(先关弹层再开设置,层级无关地正确);AI 配置页 presetNote 只说明不复制 CRUD;`session-presets.json`/prompt.ref 语义零改动。
- **E-05**:控制台 WriteCard/DistillSettingsCard/StatsCard/RecentCard 收进原生 `<details>`「高级」默认折叠;activate 后台装配(attachAutoDistill/attachWikiStore)未动。计划文中「预蒸馏检查器/访问排行/故障注入/worker 日志」经 grep 全库不存在为独立 UI 面(调研文案夸大),控制台四卡即真实高级运维面,覆盖成立。

## ② 兼容性

- 深链契约不变:`openSettingsPanel(target?)` 签名零改;旧调用方零影响;cli-config/assets section id 与 engines/agents/prompts tab id 原样。
- 老用户:persisted 钉住清单不动(marks 撤的是 pinOnce 声明,已钉者照旧);autopin 历史标记不清。
- 预期行为变更(计划内):memory-files 面板默认落地从「文件」视图改「AI 配置」首页;生态组 rail 常驻从 4 项缩到 1 项(memory-files),Memory/Skills/MCP 收 ⋯ 菜单(中心 tab 联动仍在)。

## ③ 性能

- 记忆文件探测惰性化(拆分副产物,改进);`<details>` 原生折叠零 JS;AiConfigHome 纯静态卡列表;无新增订阅/轮询。

## ④ 死代码清理

- MemoryFilesPanel 155 行视图逻辑整体迁出无残留(ACTION_CLS 仍被 HistorySide 消费);consoleTab open/toggle 分工清晰(open 导出归导航,toggle 归面板按钮);无死键(i18n 键比对 3651/4233 绿)。
- 「AI配置管理」label 虽为裸串,但 nav aria-label 的静态 `t("AI配置管理")` 早已让键入词典(en/ja 均有),PanelRail 动态 t() 可解析——无 D 批「处理」同款缺口。

## 当轮修复(1 处 P3,commit f3d3590c)

- marks order 11 注释「标记/审批线/审批/画布」为 D-01 前旧况(审批线/审批 rail 项已并),对齐为「标记/处理/通知/画布,D-01 后实况」。

## 验证

- `pnpm check:gate`:625 测试文件 4805 测试(较 D 批 +2 文件 = E 新增双契约测试)+ i18n 缺键 0/不对称 0 + build 绿。
- `npx react-doctor@latest -y`:100/100。
- 修复提交后 typecheck 复跑绿(注释级改动)。

## 待办

- 真机目检(A~E 攒一次):AI 配置首页五卡直达与禁用态、设置 tab 返回链、预设弹层「管理提示词库…」、控制台「高级」折叠、生态组取钉后 ⋯ 菜单可达性。
- 分支 ahead 9 未推送。
