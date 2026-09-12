# 05 侧栏会话分区:已置顶 / 运行区 / 工作区单一区域投影

日期:2026-09-07(用户定向需求;实现与目检同日落地)

## 结论

左侧栏会话为三区投影,顺序固定:**已置顶(scope=global 置顶)→ 运行区 → 工作区(工作区卡片 × 扁平会话行)**。运行区是纯自动聚集段:运行中与空闲-未查看的活会话跨工作区汇入,转空闲(已查看)即自动回工作区列表;置顶优先级最高,任一作用域置顶的会话永不进运行区;**一个会话同一时刻只出现在一个区域**。区空时整段隐藏(与已置顶区同口径)。2026-09-08 扁平化:CLI/终端/SSH 分组段头与折叠退役,分组仅作数据装配边界;会话管理/归档视图入口上移至工作区行动作组(见 specs/2026-09-08-workspace-sessions-flat-design.md)。状态 label 文案 2026-09-11 起「会话结束-未查看/已查看」更名「空闲-未查看/空闲」——原词被误读为进程退出,实义是本轮对话结束、CLI 仍存活。

## 契约

- 成员判定唯一真源:`workspace/utils.ts isRunningZoneCandidate(turnActive, unread) = turnActive || unread`。turnActive 取内核 `activeTurns`(输出 2s 静默窗 +「静默已过、1Hz 结算轮询未落账」的待决窗),成员资格变化恰与 activityWatch 结算通知同界,免 `Date.now()` 跨渲染竞态;契约测试在 `utils.test.ts`。
- 单一区域原则的锁步机制:运行区(`RunningZone.tsx`)与工作区分组离组过滤(`useCliSessionGroup.ts` 的 `zoneOut`)共用上述谓词——进区即离组,出区即回组,两处任何一侧单独改动即违契约。
- 置顶优先:sessionPins 任一作用域(global/workspace)置顶不进运行区;global 留已置顶区、workspace 留组顶块。从运行区右键置顶即离开本区。
- 排除项:归档会话全域隐藏不进区(与全局置顶区同口径);置顶/归档排除仅对已绑定磁盘身份的会话生效,未绑定者按状态正常进出区。
- 运行区行:标题 = 手动命名 > 磁盘原生标题(候选 (工作区,CLI) 对聚合扫描 + 3s 补扫兜自动命名晚于文件出生)> 短码;右键 = 复制 ID / 重命名 / 双作用域置顶,**无删除项**(与已置顶区同口径,删除回工作区分组操作);段折叠态 localStorage `tmd.runningSectionCollapsed`。
- 样式:段头与行形复用已置顶区槽位类,`workspace-sessions-extras.css` 仅选择器并列扩展(`.running-zone*`),零新增样式块。

## 关键文件

- `src/plugins/workspace/RunningZone.tsx` —— 运行区段组件(自动投影,无持久业务态)
- `src/plugins/workspace/useCliSessionGroup.ts` —— `zoneOut` 离组过滤
- `src/plugins/workspace/utils.ts` —— `isRunningZoneCandidate` 锁步谓词
