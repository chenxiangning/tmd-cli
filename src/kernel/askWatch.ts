/**
 * Ask 等待确认守望 —— 检测 PTY 输出中「CLI 阻塞等待用户确认」的界面标记,
 * 维护每会话等待状态(会话列表「等待确认」标签的数据源)。
 *
 * 从 askSound.ts 的第二观察者形态升级而来(见 openspec/changes/add-ask-badge/design.md):
 * 标签是首类 UI 状态而非锦上添花 —— 检测移入 host.appendOutput 主链路,
 * 一次检测两处消费(askDetected 事件 → 提示音;isWaiting → 列表标签)。
 *
 * 检测三件套(与 askSound 世代等价):原始尾巴跨分片拼接 → 剥 ANSI →
 * 页脚窗口(末 5 行)内跑保守标记正则(原语与阈值见 askDetect.ts)。
 *
 * 候选确认制(v2):单次命中即置位被实测证伪 —— omp 等全屏重绘 TUI 在作答后
 * 仍会整帧重发面板文本(作答残影,session 日志实测:面板帧 3 次,最后一次在
 * 作答之后),切换会话的 resume 回放/SIGWINCH 重绘也会把历史面板文本再流一遍;
 * 单次命中就复燃/错绑,等待中跳过检测 + 只认写入清除让标签卡死整个响应流。
 * 现在:首次命中只立「候选」;升级走双路 —— ① 复现确认:标记在后续帧复现
 * (常驻重绘面板)且距首击 ≥ ASK_CONFIRM_MS;② 静默确认:候选期满且页脚字面量
 * 仍守在尾巴里(omp Ask 面板画完即静默,复现永不到达,纯复现确认必然漏报)。
 * 瞬态文本(残影/回放)随流滚出页脚窗口,候选即撤销;作答残影另由写入清尾 +
 * 写后抑制窗双保险 —— 确认后不复燃,切换会话不错绑。
 *
 * 守望计时器(v2.1,1Hz 懒计时器,无等待/候选会话不空转)双职责:
 * 候选漂移确认(期满且命中后新输出 ≤16KB —— 静态面板仅状态栏细水长流也覆盖);
 * 等待期自愈(输出静默 2s 且尾巴再无面板字面量)。
 * 屏幕态通道(v3):omp 等待期间 spinner 以光标寻址持续重绘,静态面板标记流出
 * 字节尾窗后永不复现(实测 3h 挂起面板后流 7.4MB),字节流对此原理性无解;
 * TerminalView 1Hz 采样幕布底部 8 行喂 onScreenSample —— 屏幕可见标记 ⟺ 等待,
 * 消失即自愈(覆盖 CLI 未等写入自行继续)。字节流与屏幕态并集判定、互认边沿。
 *
 * 文件规模铁则拆分(300 行):检测原语/阈值 askDetect.ts,状态机 askWatchCore.ts,
 * host 接线 askWatchFeed.ts;本文件为入口,re-export 保持 import 契约不变。
 */

export { ASK_MARKER_RE, stripAnsi } from "./askDetect";
export { AskWatch } from "./askWatchCore";
export { AskWatchFeed, type AskWatchFeedCtx } from "./askWatchFeed";
