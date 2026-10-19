# docs/design/042-candidates/

0.4.0 批次候选深化示例组(混合版)。

- 任务:0.4.0 向内治理批已收口(tag 未打),本批五项经大仙裁定**计入 0.4.0**,不再单开 0.4.1;大仙拍板混合版(债收尾固定 + 新特性),七路并行 scout 源码核对出候选菜单(约 50 提级 20),示例组 8 页目检后大仙拍板:**1/3/4/6/7 五项入选**(推演已定稿,页面打磨后实施),2/5/8 三页删除不翻案。
- 上游:`docs/brainstorm/2026-10-18-042-next-steps.md`(规划全文 + 七路候选全文池 + 落选记录)。
- 入口:`index.html`(浏览器直接打开)。
- 可行性:`feasibility.md`(每项触发→流程→数据→失败→设置闭环 + path:line 锚点;入选五项将替换为推演定稿)。
- 设计口径:与 040/041 组一致——浅色主题(与客户端一致)、橙色强调、单文件自包含、零外部资源。

## 入选五项(拍板 2026-10-18)

| # | 页 | 候选 | 成本 |
|---|---|---|---|
| 1 | 1-path-links.html | 终端文件路径可点击 | S |
| 3 | 3-global-search.html | 跨工作区全局检索 | M |
| 4 | 4-prompt-history.html | 输入历史截断修复 + 浏览抽屉 | S-M |
| 6 | 6-restore-preview.html | checkpoint 恢复 dry-run 预览 | M |
| 7 | 7-quota-alert.html | 额度低水位告警 | S |

落选(页已删):#2 codex/qoder 懒自算短标题、#5 viewer 会话内查找、#8 设置导出/导入。

S 级随手带(不占示例名额,随批带):搜索浮层 Aa/.\* + 计数、检索多命中展开、⌘± 字号缩放、anim Windows explorer /select。债收尾批固定:空壳归档工具落地 + 真机验收债陪跑。

边界:示例仅表达交互形态,实现口径以 feasibility.md 推演定稿为准;拍板后进 openspec 立项。不做清单与被裁 8 项沿用 041 边界声明。

## 追加批(2026-10-19 · 连续性六项,大仙拍板并入本组)——已全量落地

| # | 页 | 候选 | 断点 | 成本 | 状态 |
|---|---|---|---|---|---|
| 9 | 9-session-restore.html | 重启现场恢复(会话 tab 组回位) | 跨重启 | M | 已落地 |
| 10 | 10-memory-files.html | 跨引擎原生记忆文件面板 | 跨引擎 | S-M | 已落地 |
| 11 | 11-session-changes.html | 会话变更总览(跨批次文件折叠) | 跨批次 | S-M | 已落地 |
| 12 | 12-draft-safety.html | 草稿安全网(关窗闸+草稿镜像) | 跨崩溃 | S-M | 已落地(⌘Q Rust 腿裁决取消:tauri 2.12.1 code:None=最后窗 Destroyed 拦则僵尸进程,macOS 无 ExitRequested 路径;需菜单装配另立) |
| 13 | 13-notify-session-mute.html | 通知会话级静音/暂停 | 跨打扰 | S-M | 已落地 |
| 14 | 14-transcript-export.html | 转录导出展开(批量+活会话快照) | 跨带走 | S-M | 已落地 |

首轮曾误立 docs/design/043-candidates/ 独立组,大仙拍板不建新组,已删除并并入本组;二轮七路深扫修正记录与落选增补见 `docs/brainstorm/2026-10-19-042-followup.md`。实施记录:`openspec/changes/2026-10-19-042-followup-batch/`(五批实施,每批 review 跑偏/闭环/兼容三清单;批一修帽语义/中止留存/双份逻辑,批二 review 拦下 Rust 僵尸进程 P0,批三修状态合成优先级反转,批五修远程误 evict;react-doctor 100/100)。真机目检清单见 tasks.md 集成收口段。

日期:2026-10-18(追加批 2026-10-19)
