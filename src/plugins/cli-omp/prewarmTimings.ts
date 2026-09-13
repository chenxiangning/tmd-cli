/**
 * omp 预热接管的实测时序常量,自 prewarm.ts 迁出(单文件 ≤300 行铁则)。
 * 数值都有实测依据,改动前先读注释里的实验记录。
 */

/** spawn 后就绪等待:覆盖裸启动首屏 0.6s + 扩展后台加载 ~4.5s(实测)。 */
export const READY_DELAY_MS = 6_000;
/** 命令与回车的间隔:规避 pi-tui 粘贴爆发启发式(实测 150ms 稳定提交)。 */
export const INJECT_SPLIT_MS = 150;
/** 热切换成功特征(TUI 状态行;strip ANSI 后匹配)。 */
export const RESUME_FEATURE = "Resumed session";
/** 特征等待上限:大会话历史渲染 ~1.2s,留裕量;超时 = 熔断。 */
export const RESUME_TIMEOUT_MS = 5_000;
/** 就绪待命上限:超时回收进程(内存 ~700-810MB 不白占)。 */
export const IDLE_REAP_MS = 10 * 60_000;
/** activate 后首预热延迟:避开应用启动高峰。 */
export const START_DELAY_MS = 8_000;
/** 消费成功后的补货延迟:1s 让 tab1 切换渲染(~1.2s,特征命中即完成)先收尾;
 *  不取 0 是与死区内冷启动的 loadExtensions 错峰(双 loadExtensions 并行实测可劣化到 6.5s)。 */
export const REFILL_DELAY_MS = 1_000;
/** 回放尾上限(欢迎屏 ~10KB + 大会话切换 ~170KB,留极端裕量)。 */
export const MAX_REPLAY_TAIL_CHARS = 2_000_000;
/** 出生文件锁定窗(ms):spawn 后 omp 落盘空会话通常即时,两轮覆盖慢机。 */
export const BIRTH_LOCK_DELAYS_MS = [2_000, 5_000] as const;
