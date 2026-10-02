# 工作区全量变更五路 code review(边界/性能/兼容/交互/外观)

日期:2026-10-01
状态:已完成(修复 2 项 + 误报核实 20+ 项;门禁全绿;未提交)

## 结论

对工作区未提交全量变更(+4673/-1707,227 改 + 40 新文件,分支 Tmd-0.2.8)按五路并行评审(mobile 树 / 插件群 A / 插件群 B / kernel+shell+styles / Rust+文档登记)。评审团共报 30+ 条疑似问题,逐条对照代码核实后**绝大多数为误报**——该工作区已历经三轮自查(ui-polish 65 项、deadcode 评审、spec 门禁),真实问题仅收敛为 2 项,均已修复。

## 修复项

1. **session-relay 单条 500 字截断劈开代理对**(relay.ts truncateItem):`slice` 按 UTF-16 码元切,截点落在 emoji/增补平面字符中间时产出孤立代理对,经 JSON 序列化成坏码点进接力提示词。修法:截点处检测高位/低位代理对相邻则回退一位;relay.test.ts 新增用例钉死(BMP 用例不变仍绿)。
2. **cargo fmt 漂移**(render_health_tests.rs 注释缩进):`cargo fmt` 收敛,`--check` 恢复绿。

## 误报核实摘录(重点,防后世重查)

- structured-session「select 部件静默替答/取消钮发 false」:piRpc.ts 实现为非 confirm 部件自动 `cancelled:true` + 转录 notice,与 spec 一致;confirm 卡 Esc=拒绝、聚焦拒绝钮,语义正确。
- mobile「发送失败静默丢草稿」「git 状态失败伪装空」:SessionScreen 有 sendErr 态 + 失败保草稿 + 在途闸;CkptSheet/GitScreen 均有 error 态分流;history.ts 单引擎失败=该引擎空 + 60s 重扫,注释明示为设计。
- marks「lost 定位 no-op / 硬编码中文」:locateMark 有完整指纹重锚 + 三态提示;STATE_LABEL 经 t() 消费(中文键即词典键,仓库惯例)。
- TerminalView「双订阅」:清理块逐项 dispose,无重复;ExitSessionToast 定时器有 clear;StyledSelect 无陈旧标签问题。
- academy courseVersion / practiceGate:纯函数无模块顶层 t();aiDrawPoller 防重入/停止/失焦通知三闸齐备;GenSettings 引擎表派生自 getCliProfiles 非手抄。
- Rust:render_health_tests.rs 经 `#[path]` 挂载(5 测试实跑);版本三处一致(0.2.7);新文档 5 份均已登记 docs/README.md。
- session-search 无 RegExp 构造(纯 indexOf),无注入面;fs_search 契约含 truncated 位,诚实。

## 遗留观察(不修,记录在案)

- 首轮全量 vitest 出现 1 例偶发失败(未捕获到用例名),随后 3 次全量复跑全绿(445 文件 / 3461 用例);与 scratchpad 里 sessionArchive.test.ts 首跑偶发史同型,提交收口时若再现再定位。
- 手机 home 磁盘历史「单引擎扫描失败=该引擎空」与桌面「缺失显示 —」纪律的差别:属 60s 重扫可自愈的瞬态降级,维持现状;若要逐引擎错误态属桥命令域扩展,超本轮。

## 验证

typecheck ✓;vitest 445 文件 / 3461 用例全绿 ✓;check:arch-boundary(R1/R3/R4)✓;check:file-size ✓;pnpm build ✓;cargo fmt --check + clippy -D warnings + test(335 passed / 5 ignored)✓;react-doctor 100/100 ✓。全程零 git commit。
