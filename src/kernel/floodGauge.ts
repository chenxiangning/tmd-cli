/**
 * PTY 洪水标尺 —— 渲染粘死守望的「勿雪上加霜」信号(leaf 模块,零 import)。
 *
 * 背景(2026-09-30 第三轮卡死取证):多会话并发工作期,omp 等 TUI 以 15-20 tick/s
 * 持续局部重绘,三会话合计 ~120MB/h 流向前端;xterm DOM 渲染器行重建把主线程
 * 顶到饱和,rAF 饿死触发守望。此时 reload 自愈 = 重放输出缓冲 + 重挂全部幕布,
 * 在洪水未停时立即再冻结 —— 越自愈越卡。守望须在洪水期降级(reload → focus),
 * 本模块给 rafFallback(动态 import transport,不能静态拖 host 图)与 Rust 侧
 * 提供一个无依赖的洪水判据:hostWatches.appendOutput 喂字节数,滑动窗超阈值
 * 即「洪水期」。
 *
 * 阈值:5s 窗 >256KB(≈50KB/s 持续流)为洪水 —— 单会话 omp 工作期 ~20KB/s,
 * 两三个并发才过线;日常打字/单 tick 更新远低于此,不会误降级。
 */

const WINDOW_MS = 5_000;
const HEAVY_BYTES = 256 * 1024;

let windowStart = 0;
let windowBytes = 0;
let heavyUntil = 0;

/** appendOutput 逐批喂入(字符数;阈值按同量纲标定)。 */
export function notePtyBytes(n: number): void {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    windowBytes = 0;
  }
  windowBytes += n;
  if (windowBytes >= HEAVY_BYTES) heavyUntil = now + WINDOW_MS;
}

/** 当前是否洪水期(5s 滑动窗超阈值后再保持 5s,退洪立即转 false)。 */
export function isPtyFloodHeavy(): boolean {
  return Date.now() < heavyUntil;
}

export function resetPtyFloodForTest(): void {
  windowStart = 0;
  windowBytes = 0;
  heavyUntil = 0;
}
