/**
 * rAF 失活垫片 + 渲染健康守望 —— 幕布冻结(P0)的两层防线。
 *
 * 症状链(2026-09-30 现场取证 + 受控复现,worktree 诊断实例):
 * WKWebView 在窗口隐藏/最小化/被遮挡期间停发原生 rAF 且吊销渲染更新;
 * 恢复可见后,WebKit(macOS 27.0)偶发不再恢复 —— 页面 `document.hidden`
 * 恒粘 true、rAF 永久死、像素停在旧帧;≥500ms 定时器常存活,50ms 级
 * 定时器在吊销态同样饥饿。用户观感:终端(乃至整个 UI)卡死在旧画面。
 *
 * 第 1 层(垫片,既有):每次 rAF 调度同时挂 50ms setTimeout 兜底,先到先执行。
 * 仅救「部分遮挡」形态(实测 ~14fps 地板帧率);对「吊销态」无效 ——
 * 50ms 级定时器同样饥饿,但保留它零成本且有正收益。
 *
 * 第 2 层(守望,本次新增):原生 rAF 探针 + 看门狗,检出两类卡死并上报 Rust:
 * - 形态 A(遮挡粘死):原生 rAF 停 >10s 且 `document.hidden === false`
 *   (页面自认可见,渲染实际被吊销)→ 看门狗自动上报。
 * - 形态 B(隐藏粘死):`document.hidden` 恒粘 true,JS 无法自知;Rust 在
 *   窗口 Focused(true) 时经 eval 戳 `__tmdRenderProbe()`,探针无条件上报,
 *   由 Rust 按「窗口已可见」裁断。
 * Rust 侧阶梯(set_focus → webview reload)见 src-tauri/src/render_health.rs;
 * reload 语义安全:会话/PTY 注册表跨 webview 重载存活(sessionAdopt)。
 *
 * 上报经 transport invoke(动态 import:本模块在 main.tsx 首位求值,静态引
 * transport 会把整条传输图提前到垫片之前,破坏「垫片先装」的求值序)。
 */

const RAF_FALLBACK_MS = 50;
const INSTALLED_FLAG = "__tmdRafFallbackInstalled";
/** 看门狗节拍;原生 rAF 停发超过该值且页面自认可见 = 形态 A,上报。 */
const STUCK_GAP_MS = 10_000;
/** 探针判活阈值(Rust Focused 戳醒时用,窗口刚获焦,要求更严)。 */
const PROBE_OK_GAP_MS = 3_000;
/** 上报最小间隔:防粘死态每秒轰炸 Rust。 */
const REPORT_MIN_INTERVAL_MS = 10_000;
/** 健康恢复上报:一次粘死后恢复,要通知 Rust 清 strikes(只在「曾上报过粘死」时)。 */
type Pending = { rafId: number; timer: number };

/** 原生 rAF 引用:模块求值期先于包装捕获(探针必须看到未被垫片替换的原生行为)。 */
const nativeRaf: typeof requestAnimationFrame =
  typeof window !== "undefined" ? window.requestAnimationFrame.bind(window) : () => 0;

/** 原生 rAF 最近触发时刻;0 = 尚未触发(冷启动窗口内不算粘死)。 */
let lastNativeFireAt = 0;
let probePending = false;
let lastReportAt = 0;
let reportedStuck = false;

function nativeProbe(): void {
  probePending = false;
  lastNativeFireAt = Date.now();
  armProbe();
}

function armProbe(): void {
  if (probePending) return;
  probePending = true;
  nativeRaf(() => nativeProbe());
}

/** 当前原生 rAF 间隙;lastNativeFireAt 为 0(从未触发)时返回 0,冷启动不误报。 */
export function nativeRafGapMs(): number {
  if (!lastNativeFireAt) return 0;
  return Date.now() - lastNativeFireAt;
}

/** 探针上报(形态 B 入口):Rust 在 Focused(true) 时 eval 戳这里,无条件上报。 */
export function probeRenderHealth(): void {
  void report(nativeRafGapMs() < PROBE_OK_GAP_MS);
}

async function report(ok: boolean): Promise<void> {
  const now = Date.now();
  /* 去重只限粘死态重复轰炸;恢复上报是边沿事件,必须放行清 Rust 侧 strikes。 */
  if (!ok && now - lastReportAt < REPORT_MIN_INTERVAL_MS) return;
  reportedStuck = !ok;
  lastReportAt = now;
  try {
    const { invoke } = await import("./transport");
    void invoke("render_health", { ok, gapMs: nativeRafGapMs() }).catch(() => undefined);
  } catch {
    /* 浏览器桩/测试替身无 transport:静默(守望只服务桌面壳)。 */
  }
}

export function installRafFallback(): void {
  const w = window as typeof window & { [k: string]: unknown };
  if (w[INSTALLED_FLAG]) return; /* HMR/重复 import 防连环包裹 */
  w[INSTALLED_FLAG] = true;
  (w as { __tmdRenderProbe?: () => void }).__tmdRenderProbe = probeRenderHealth;

  armProbe();
  window.setInterval(() => {
    armProbe(); /* 吊销期挂起的回调在恢复时会补发;守望侧再补一臂,保链条永续。 */
    const gap = nativeRafGapMs();
    if (gap < STUCK_GAP_MS) {
      if (reportedStuck && gap < PROBE_OK_GAP_MS && lastNativeFireAt) void report(true);
      return;
    }
    if (document.hidden) return; /* 形态 B 归 Rust Focused 探针管辖 */
    void report(false); /* 形态 A:页面自认可见,渲染被吊销 */
  }, 1_000);

  const nativeRafRef = w.requestAnimationFrame as typeof window.requestAnimationFrame | undefined;
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
      rafId: typeof nativeRafRef === "function" ? nativeRafRef.call(window, run) : 0,
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
