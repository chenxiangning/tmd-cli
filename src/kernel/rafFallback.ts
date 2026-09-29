/**
 * rAF 失活垫片 —— 幕布冻结(P0,2026-09-30 大仙实证)的根治点。
 *
 * 症状链(omp 会话 01a0edfc 现场取证):会话与 PTY 全程健康 —— 会话 jsonl
 * 完整收尾(stop 正常)、Rust 泵日志逐字节连续(冻结点 ~19.7M,收尾帧在
 * ~24.8M),幕布却停在 01:30 的旧帧,之后 3 分半的输出一帧未画。字节卡死
 * 在「webview 已收到 → xterm 画出」之间,且持续到窗口重新可见之后。
 *
 * 根因:xterm 的渲染刷新只经 RenderDebouncer 的 requestAnimationFrame 调度,
 * 无任何兜底;WebKit 在窗口被遮挡/最小化期间停发 rAF(macOS 遮挡状态偶发
 * 卡死或恢复缺陷),恢复可见后 rAF 不再触发 —— 解析器走 setTimeout 链照常
 * 吃字节进缓冲,渲染层永久停在旧帧。React 面不走 rAF(MessageChannel 调度),
 * 其余 UI 照常,唯独幕布冻死,观感即「会话莫名其妙终止」。
 *
 * 垫片:每次 rAF 调度同时挂 RAF_FALLBACK_MS 的 setTimeout 兜底,先到先执行
 * (幂等防双跑);rAF 正常时真帧(16.7ms)恒先于兜底窗(50ms),迟到的兜底
 * 定时器以 no-op 触发(done 早退)零影响;rAF 失活时以 ~20fps 地板帧率继续
 * 画幕布。cancelAnimationFrame 双源同撤。
 *
 * 取舍与边界:①遮挡期从「rAF 按设计暂停」变为 20fps 地板帧 —— 对幕布正是
 * 修复本体;wallpaper 流体循环只监听 document.hidden,纯遮挡不触发
 * visibilitychange,会继续画看不见的帧(JS 无法区分「按设计暂停」与「失活」,
 * 接受)。②若 WebKit 连定时器也停发(进程级挂起/App Nap),垫片同死,只能
 * 壳层(Rust 心跳 + webview 戳醒)恢复 —— 现场取证未见过该形态(冻结期
 * 解析器 setTimeout 链持续吃字节),不为它建机制。
 */

const RAF_FALLBACK_MS = 50;
const INSTALLED_FLAG = "__tmdRafFallbackInstalled";

type Pending = { rafId: number; timer: number };

export function installRafFallback(): void {
  const w = window as typeof window & { [k: string]: unknown };
  if (w[INSTALLED_FLAG]) return; /* HMR/重复 import 防连环包裹 */
  w[INSTALLED_FLAG] = true;

  const nativeRaf = w.requestAnimationFrame as typeof window.requestAnimationFrame | undefined;
  const nativeCaf = w.cancelAnimationFrame as typeof window.cancelAnimationFrame | undefined;
  const pending = new Map<number, Pending>();
  let nextId = 1;

  w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    let done = false;
    const run = (t: number): void => {
      if (done) return;
      done = true;
      pending.delete(id);
      cb(t);
    };
    const entry: Pending = {
      rafId: typeof nativeRaf === "function" ? nativeRaf.call(window, run) : 0,
      timer: window.setTimeout(() => run(performance.now()), RAF_FALLBACK_MS),
    };
    pending.set(id, entry);
    return id;
  };
  w.cancelAnimationFrame = (id: number): void => {
    const entry = pending.get(id);
    if (!entry) return;
    if (entry.rafId && typeof nativeCaf === "function") nativeCaf.call(window, entry.rafId);
    clearTimeout(entry.timer);
    pending.delete(id);
  };
}

if (typeof window !== "undefined") installRafFallback();
