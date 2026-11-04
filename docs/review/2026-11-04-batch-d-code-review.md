# 2026-11-04 减法批次 D 代码评审(a8cf4b02)

结论:D-01~D-04 四项全部落地合规,无 P0/P1/P2 缺陷;当轮修 3 处 P3(label i18n 缺口×1、陈旧注释×1、ja 键序注释×1),修复后全链 gate(623 文件/4798 测试)+ react-doctor 100 复跑绿。真机目检(D-01 双域切换 / D-03 三作用域浮层)待办,与 A~C 批共用一次目检窗口即可。

评审对象:`a8cf4b02 refactor(subtraction): 批次D收口` 21 文件 +790/-307;对照 `docs/research/client-feature-rationalization-2026-11/implementation.md` §5(D-01~D-04)逐条验收。工作区净,分支 tmd-0.4.9 ahead 6 未推送。

## ① 功能实现准确性 / 架构契合度

- D-01 四启停组合语义全部正确且有契约测试钉住(`reviewPanel.contract.test.tsx` 注册面 + `reviewRuntime.contract.test.ts` 订阅面):
  - both = 单一「处理」宿主(id 不变 checkpoints,order 12),approval-inbox 不注册 rail 项但 boot 照常(askDetected/host 订阅恰一份);
  - only approval = 原「审批」兜底面板(order 13);only checkpoints = 处理宿主仅变更域、ask 零订阅;both off = 无面板无订阅。
- `getSettingsState()` 一次性读 disabledPlugins 正确:pluginLifecycle.activateAll 等首载后过滤、重启生效口径(session-search 侧注释与插件市场一致),activate 期读即最终态。ReviewPanel 内用 `useSettingsState` 响应式兜运行期热改,超出必要但无害。
- 跨插件 import 三处(checkpoints→approval-inbox/panel、search→session-search/SearchBody、session-search→search/overlayStore)均为叶子模块,无模块环,有先例(seeConversation→structured-session/tabs),不触 R1/R4。
- D-02 `pinnedByDefault:false` 接 kernel 契约正确(filePanel.ts:缺省 true;权威清单 pinned.v1 存在即权威,不强制改)。
- D-03 统一壳三分支正确;SessionsBody 双闸(session-search 禁用 / 无活动工作区)防御到位且不偷启索引;两壳互斥注册(search 禁用才注册原壳),toast 恒单实例;索引扫描随关壳/切作用域 unmount cleanup 取消;searchLogic 抽取逐行对照原实现零行为漂移。
- HubEntry 三命令不变,未注册命令禁用态提示,无第二入口。

## ② 兼容性

- 面板 id 全部不变(checkpoints/approval-inbox/notify-center),pinned.v1 深链与钉住清单零迁移;Ask 历史 key、notify-log、索引缓存不动,合计划。
- 预期内行为变更两处(计划明示,非缺陷):⇧⌘F/⌘P 统一壳新增 bg-black/45 遮罩(原全文/快开无暗化);从未动过钉住清单的老用户通知中心从常驻 rail 收进溢出菜单(隐式钉不在权威清单,减法目标本身)。
- Cmd+O 键位/命令标题/session-search.open id 不变,改键跟随。

## ③ 性能

- SearchOverlay 常驻 portal(kind null 时仅 toast null 渲染)零实质成本;ReviewPanel keepAlive 双域隐藏切换(Ask 域挂载即订阅 ask store)以少量内存换应答草稿/展开态不丢,先例 CheckpointsPanel 三视图;无新增每帧开销。

## ④ 死代码清理

- QuickOpen/SearchPanel 内联常量与分组函数已迁 searchLogic 无残留;ResultBody 再导出仍被 SearchOverlay.test.tsx 消费(测试缝)非死码;旧「审批线」label 本无词典键,无死键可清。

## 当轮修复(3 处 P3,未提交前修复)

1. **处理宿主 label i18n 缺口**:PanelRail 渲染走 `t(panel.label)`,D-01 改名后的「处理」无 en/ja 键(旧「审批线」同样裸奔,动态键 i18n 静态比对不拦)。修:checkpoints/index.tsx `label: t("处理")`(notify 先例,注册期 t() 让键静态可见)+ locales 补 en "Review" / ja "処理"。
2. notify order 14 注释「紧随审批收件箱(13)」过时(both 组合下该 rail 项不存在),改「紧随处理宿主(12)/审批兜底(13)」。
3. locales ja 段 D-01 注释与键序整理(等待键注释保留,处理键插入致键序说明对齐)。

## 验证

- `pnpm check:gate` 全链两轮(修复前后):typecheck + 623 测试文件 4798 测试 + 架构边界 + 300 行 + i18n(缺键 0/不对称 0/处理无死键)+ build 全绿。
- `npx react-doctor@latest -y`:100/100(修复前后各一轮)。
- 契约测试定向复跑:checkpoints 双文件 8/8。

## 待办

- 真机目检(D-01 双域切换/等待域应答流、D-03 三作用域开合/Esc/IME/遮罩、D-02 通知激活外显):仓库 UI 行为改动目检铁则,建议 A~D 批合并一次 `pnpm tauri:dev` 目检收口。
- 分支 ahead 6 未推送:推送前 gate 已绿(本评审后树上)。
