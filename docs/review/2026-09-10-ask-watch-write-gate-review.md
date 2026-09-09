# Ask 提醒不及时/后台不出现:写后抑制窗误伤根因评审与修复记录

- 日期:2026-09-10
- 状态:已完成(修复随本记录同在工作树,未提交)

## 症状(用户报告)

omp 会话的 Ask 面板已画在幕布上,但「等待确认」提醒(侧栏徽章/tab 圆点 + 提示音)迟迟不出;客户端在后台时更是完全不出。

## 根因(两条独立缺陷叠加)

### 根因一:写后抑制窗对所有写入无条件上闸

`askWatchCore.ts` 旧 `onUserWrite` 对任何写入(包括普通发消息)都记 `lastWriteAt` 并上 8s 抑制窗。设计意图是「作答残影抑制」——已答面板块在屏幕上逗留数秒,窗内命中不升级。但「普通发消息后出现的新提问」不是残影,也被压 8s。

更致命的是与漂移撤销的预算矛盾:omp 静态 Ask 面板画完即静默,等待期 spinner 细水长流 ≈3.1KB/s,16KB 漂移阈值 ≈5.3s 即撤销候选(`askWatchCore.ts` 守望漂移路径)——候选在 8s 抑制窗到期前先被撤销,字节通道原理性沉默。屏幕通道(`TerminalView` 1Hz 采样)又同样被抑制窗压住,窗后才记起算,再付 1.2s 防抖 + 1Hz 采样 —— 前台亮标被拖到 ≈9-10s;未挂载 TerminalView 的会话(保活条外)只剩字节通道 → 永久沉默。

### 根因二:synthetic 终端回传也走 `askWatch.onUserWrite`

`hostWatches.ts` 的 `onUserWrite` 扇出只对 activityWatch/editWatch 区分 synthetic,对 askWatch 无差别调用。`terminalReports.ts` 已精确分类出焦点/鼠标/查询应答字节不是用户输入,但它们照旧清候选、清尾巴、清屏幕起算、重启 8s 抑制窗 —— 点一下终端、切一次 tab(焦点 in/out 回传)、选中一段文字(SGR 鼠标)就把亮标无限推迟。

## 修复(两处,最小 diff)

1. `hostWatches.ts` onUserWrite:synthetic 回传直接 return false,三守望一概不碰。
2. `askWatchCore.ts` onUserWrite:仅当写入时确有等待态(`waiting`/`waitingByScreen`/候选/屏幕起算任一,即「真作答」)才记 `lastWriteAt` 上 8s 闸;清尾/清候选行为不变。feed 级 `lastWriteAt`(restoreDiskTail 闸)维持无条件记录 —— 磁盘回放窗内的写入即便无 ask 状态也可能是对碑帧提问的作答。

修复后时序:普通发送 → 2s 后新提问到达 → 字节候选 → 守望 1Hz 漂移确认(确认时漂移 ≈6KB < 16KB)→ ≈2s 亮标。真作答后的连续多问维持原设计语义:抑制窗 8s + 屏幕通道兜底 ≈9-10s(已答残影与下一问在字节/屏幕两通道都原理性不可区分,时间窗是唯一判据)。

## 回归测试(3 个新用例,均钉行为契约)

- `askWatch.test.ts`:普通发送(无等待态)后的新提问不上闸,spinner 流下 ~2s 亮标(旧行为:上闸 8s + 漂移 5.3s 先行撤销 → 永不亮标)。同文件「静态残影在写后抑制窗内不被静默确认升级」用例补齐真实作答前置状态(旧用例写入时无任何 ask 状态,钉的是被修复的缺陷行为本身)。
- `askWatch.host.test.ts`:synthetic 回传(焦点离开/鼠标点击)不清候选、不摘等待标签;真实击键才作答。
- `askWatch.screen.test.ts`:普通发送后屏幕通道不上闸,~2.2s 置位。

## 验证

- `pnpm exec vitest run src/kernel/askWatch*.ts src/kernel/askWatchFeed*.ts`:5 文件 54/54 全绿。
- 全量 `pnpm test`:1328/1329,两处失败均为并行会话在途文件(localPlugins.test.ts 编译失败、settings.test.ts 快照缺 localPluginTrust/localPluginsDisabled),与本次无关。
- `pnpm check:arch-boundary` 绿;`check:file-size` 本次文件全合规(askWatchCore 298 行;存量违规 host.ts 303 / plugins.rs 409 均为并行会话)。
- `pnpm exec vite build` 绿;`pnpm build` 前置 tsc 被并行会话 localPlugins 文件阻断(18 错误全在对方文件)。
- 桩目检(1421 dev server + Tauri 桩,真实 HMR 代码):普通发送后 2s 注入 Ask 字节 → `host.isWaitingConfirm` ≤5s 内置位(旧码此点必为 false)。徽章像素层未能在桩环境完成断言 —— 手工 createSession 的会话不挂工作区,侧栏行与 tab 条在桩里均不渲染(rows:0/tabIds:[]),与本次改动无关(渲染链路未动);目检配方教训见记忆 scratchpad。

## 顺手修正

- `askDetect.ts` 抑制窗注释改写:预算约束(16KB 漂移 ≈5.3s vs 8s 窗)写明「连续多问亮标由屏幕通道兜底」,勿把抑制窗当通用延迟。
- `askWatchCore.ts` 文件头状态迁移注释同步:omp 静态面板字节候选会被漂移先行撤销,屏幕通道窗后兜底。

## 残余权衡(已知上限,不修)

- 连续多问(真作答后 8s 内下一问):亮标仍 ≈9-10s。omp 静态面板在字节通道无法区分残影与新问,缩短窗口会把已答残影误判复燃(闪烁假亮标)。若日后要优化,判据信号得从协议层拿(如光标位置/焦点件),属新设计而非修复。
- 鼠标点击作答不再即时摘标签(synthetic 不再当作答),靠屏幕自愈(≤1-2s)摘除;连续多问间不再逐问触发提示音边沿。omp/pi-tui Ask 是键盘驱动交互,影响面小;若需精确,可在 terminalReports 拆 SGR 鼠标「点击/移动」子类,届时再议。
