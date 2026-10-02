# 界面模块打磨轮提交前三路评审(交互/视觉词条/边界性能)

- 日期:2026-10-02
- 状态:已完成(实锤 5 全修 + 疑似择修 6;门禁全绿后随 d3070345 提交)
- 范围:未提交的 106 文件模块打磨 diff;三路只读评审(交互行为/视觉与 i18n/架构边界与性能)+ 主会话修复
- 性质:评审记录,修复已并入同批提交

## 结论先行

行为与契约面核验通过(保活三处无隐藏态副作用、右键菜单传递链完整、重试链路真回忙态、深链闭环、Effect 依赖全数正确);实锤集中在两类:**保活拆掉「卸载即停轮询」免费闸门**(5 处 hook 隐藏态全开)与 **CSS/文案回归**(mgrid 非法 min() 整条丢弃、mask 常驻失真、强删能力随双击暗道移除而消失)。全部修复;误报 1(附件全部清除 store 疑点,函数式更新已正确处理)。

## 实锤与修复

| # | 发现 | 修复 |
|---|---|---|
| 1 | 隐藏面板轮询全开(useVisiblePoll/gitDecorate/useRepoBranches/approval 1s tick/ckpt 6s/ssh 15s/messageAnchors 2s/BatchRow open 批):保活后旧免费闸门失效 | 新立 kernel `panelActivity` context(PanelActiveProvider + usePanelActive);DesktopColumns 按面板注入;八处轮询/订阅接活性门控(隐藏短路、回切即刷;TimelinePanel 按活性退订,store 订阅计数归零停 tick) |
| 2 | BranchRow 强删能力消失:两击改造后全仓无 `gitDeleteBranch(...,true)` 调用点,确认框文案仍指向已删的双击暗道 | run() 加 onReject 定制出口;安全删被拒自动追加强删确认(「强制删除」二级 danger 弹层),force 链路恢复;detail 文案如实化;5 词条三语补齐 |
| 3 | `.dj-mgrid` `minmax(min(128px,1fr),1fr)` 非法(min() 混型)被 Blink 整条丢弃,月格塌单列 | 改 `minmax(0,1fr)`(窄窗列宽可降,防横滚) |
| 4 | 双 tab 条 mask 渐隐常驻:未溢出也裁最后一张、滚到尽头不撤 | fade-end 条件类:JS 溢出感知(scrollWidth-clientWidth-scrollLeft>1),scroll/wheel 后复算 |
| 5 | 「批次 #{index} · {state} · {time}」拆串后 en/ja 死键 | 双语删除 |

## 疑似与择修

- 已修:latched 随注册表修剪(防同 id 重注册误预挂);SkillHubPanel 两行深链接全(store/import);skill-hub 安装钮与 mcphub-accent-btn 同款化(圆角/内距/过渡);`.sb-card.hl:hover` 悬停反馈;tab 双钮 focus-visible 全显。
- 留观:mcp-hub hubStore configHomeDir 失败静默空态(HOME 不可解析才触发,罕见);mask 的 ResizeObserver 级精确性(现 scroll/wheel/挂载三时机复算已够)。
- 误报摘录(防重查):附件「全部清除」store 未清疑点(函数式更新已正确处理批量清除,注释明示);SessionTab 拆分未 memo(与旧整条 map 重渲等价);cli-omp 词典 Object.assign 覆盖顺序(未来迁移既存词条时留意)。

## 验证

隔离态(cli-dsh WIP stash)全门禁:typecheck 0 错、450 文件全绿(dsh-zone 计时测试负载 flaky,单跑复验过)、file-size/arch/i18n/build 全过;react-doctor 100(唯一残留在 cli-dsh 用户在途文件)。含 WIP 态复跑 452 文件/3507 测全绿。提交按路径排除 cli-dsh(d3070345)。

## 附注

- `stash@{0}(review-verify)` 为隔离验证时的 cli-dsh 快照,工作树已有更新内容,确认后可 `git stash drop`。
- 测试覆盖缺口(记录):DesktopColumns latched、TabContextMenu 三新行、BranchRow 3s 武装、retry 四处、深链跟随——行为经人工链路核验,单测留下轮。
