/**
 * 终端 WebGL 渲染器 opt-in 装配 + 自检降级(增强点 11)。
 * 设置 terminalWebglRenderer(默认关)开时经 dynamic import 装载 @xterm/addon-webgl
 * (不进主包;性能对比见 bench/webglBench.ts)。已知上游缺陷:WebKit texSubImage2D
 * glyph atlas 长跑损坏成马赛克且 onContextLoss 不触发 → 装载后 5s 一次 RAF 像素
 * 探针抽查 canvas 有无输出,连败 2 次即 dispose 回落 xterm 内建 DOM 渲染器,并以
 * localStorage 记忆降级:记忆后不再自动装,用户重开设置(设置页开关 onClick 调
 * clearWebglDegradedMemory)清除记忆才重试。
 */
import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
import { getSettingsState, subscribeSettings } from "./settings";

export const WEBGL_DEGRADED_KEY = "tmd-webgl-degraded";
const PROBE_INTERVAL_MS = 5_000;
const PROBE_FAIL_LIMIT = 2;
const PROBE_SIZE = 32;

/* localStorage 私隐模式/配额满可抛:记忆是尽力而为,失败仅本次降级不记忆。 */
function isDegraded(): boolean {
  try {
    return localStorage.getItem(WEBGL_DEGRADED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDegraded(): void {
  try {
    localStorage.setItem(WEBGL_DEGRADED_KEY, "1");
  } catch {
    /* 见上 */
  }
}

/** 清降级记忆,用户重开设置时允许重试装载;设置页开关转「开」的 onClick 调用。 */
export function clearWebglDegradedMemory(): void {
  try {
    localStorage.removeItem(WEBGL_DEGRADED_KEY);
  } catch {
    /* 见上 */
  }
}

/** 可见视口有无文本(探针前置:空幕布读全透明是正常态,不计数)。 */
function viewportHasText(term: Terminal): boolean {
  const buffer = term.buffer.active;
  for (let row = 0; row < term.rows; row++) {
    if (buffer.getLine(row)?.translateToString(true).trim()) return true;
  }
  return false;
}

/** 像素探针:缩样 32×32 读 alpha,任一非透明 = canvas 有输出(webgl 每帧以主题
 *  背景色清屏重绘,活上下文恒有输出;上下文死/绘图缓冲被清读全透明)。无 2D
 *  探针上下文时判活不计数,交给 onContextLoss。 */
function canvasHasOutput(src: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = PROBE_SIZE;
  probe.height = PROBE_SIZE;
  const ctx = probe.getContext("2d");
  if (!ctx) return true;
  ctx.drawImage(src, 0, 0, PROBE_SIZE, PROBE_SIZE);
  const data = ctx.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true;
  }
  return false;
}

/** 装载一次:设置关/已记忆降级返回 null,否则返回卸载 cleanup(幂等)。装载失败
 *  (无 WebGL 上下文/模块加载失败)即时记忆降级并回落 DOM。须在 term.open 之后调
 *  (装载即接管渲染,需要 element 与尺寸)。 */
export function attachWebglRenderer(term: Terminal): (() => void) | null {
  if (!getSettingsState().settings.terminalWebglRenderer) return null;
  if (isDegraded()) return null;
  let addon: WebglAddon | null = null;
  let disposed = false;
  let probeTimer: ReturnType<typeof setTimeout> | undefined; /* 双 lib(DOM number/Node Timeout)setTimeout 返回型不一致,仓内约定型(terminalStream 同款) */
  let probeFails = 0;

  function unload(): void {
    clearTimeout(probeTimer);
    probeTimer = undefined;
    const target = addon;
    addon = null;
    try {
      target?.dispose(); /* dispose 即回落 xterm 内建 DOM 渲染器 */
    } catch {
      /* 幕布销毁后已随 term 释放,重复 dispose 忽略 */
    }
  }

  function degrade(): void {
    markDegraded();
    unload();
  }

  function scheduleProbe(): void {
    probeTimer = setTimeout(probeTick, PROBE_INTERVAL_MS);
  }

  function probeTick(): void {
    if (disposed || !addon) return;
    const host = term.element;
    const canvas = host?.querySelector("canvas") ?? null;
    /* 隐藏幕布(display:none)/页面后台/空幕布:读数不可信或无判据,跳过不计数。 */
    if (!canvas || !host || host.offsetParent === null || document.hidden || !viewportHasText(term)) {
      scheduleProbe();
      return;
    }
    /* RAF 帧内读:webgl 绘图缓冲合成后失效,帧外读恒全透明不可作判据。 */
    requestAnimationFrame(() => {
      if (disposed || !addon) return;
      if (canvasHasOutput(canvas)) {
        probeFails = 0;
      } else if (++probeFails >= PROBE_FAIL_LIMIT) {
        degrade();
        return;
      }
      scheduleProbe();
    });
  }

  void import("@xterm/addon-webgl").then(
    ({ WebglAddon: Ctor }) => {
      if (disposed) return;
      try {
        addon = new Ctor();
        addon.onContextLoss(() => degrade());
        term.loadAddon(addon);
      } catch {
        degrade(); /* 无 WebGL 上下文等装载异常:回落 DOM 并记忆 */
        return;
      }
      if (typeof requestAnimationFrame === "function") scheduleProbe(); /* node 无 RAF:跳探针 */
    },
    () => degrade(),
  );

  return () => {
    disposed = true;
    unload();
  };
}

/** TerminalView 装配点:随设置翻转即时重挂/卸载(仅值变化时;settings 写入面极广,
 *  置顶/重命名等日常动作不得触发渲染器重建)。返回总 cleanup(幕布卸载时调用)。 */
export function attachWebglRendererAuto(term: Terminal): () => void {
  let enabled = getSettingsState().settings.terminalWebglRenderer;
  let detach = attachWebglRenderer(term);
  const off = subscribeSettings(() => {
    const next = getSettingsState().settings.terminalWebglRenderer;
    if (next === enabled) return;
    enabled = next;
    detach?.();
    detach = attachWebglRenderer(term);
  });
  return () => {
    off();
    detach?.();
  };
}
