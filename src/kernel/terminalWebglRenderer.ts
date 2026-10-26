/**
 * 终端 WebGL 渲染器 opt-in 装配(增强点 11;2026-10-26 复审后单真源化)。
 * 设置 terminalWebglRenderer(默认关)是唯一真源:开时经 dynamic import 装载
 * @xterm/addon-webgl(不进主包;性能对比见 bench/webglBench.ts)。
 * 异常路径:onContextLoss / 装载失败 → updateSettings 直写 false,设置开关
 * 如实回落「关」,卸载走 TerminalView 的 attachWebglRendererAuto 既有回调统一
 * 处理;用户重开开关即真重试(不再有 localStorage 记忆双真源)。
 */
import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
import { getSettingsState, subscribeSettings, updateSettings } from "./settings";

/** 装载一次:enabled=false 返回 null;装载成功返回卸载 cleanup(幂等)。
 * 隐藏幕布(display:none)element 宽度为 0 时跳过返回 null——0 尺装载失败
 * 不是渲染器问题,不触发降级;设置回开/auto 回调会在幕布可见时重试装载。
 * 须在 term.open 之后调(装载即接管渲染,需要 element 与尺寸)。 */
export function attachWebglRenderer(
  term: Terminal,
  enabled: boolean,
): (() => void) | null {
  if (!enabled) return null;
  const host = term.element;
  if (host && (host.offsetWidth === 0 || host.clientWidth === 0)) return null;
  let addon: WebglAddon | null = null;
  let disposed = false;

  function unload(): void {
    const target = addon;
    addon = null;
    try {
      target?.dispose(); /* dispose 即回落 xterm 内建 DOM 渲染器 */
    } catch {
      /* 幕布销毁后已随 term 释放,重复 dispose 忽略 */
    }
  }

  /** 降级唯一出口:直写 settings 关,开关如实回落;卸载交 auto 回调统一处理。 */
  function degrade(): void {
    unload();
    updateSettings({ terminalWebglRenderer: false });
  }

  void import("@xterm/addon-webgl").then(
    ({ WebglAddon: Ctor }) => {
      if (disposed) return;
      try {
        addon = new Ctor();
        addon.onContextLoss(() => degrade());
        term.loadAddon(addon);
      } catch {
        degrade(); /* 无 WebGL 上下文等装载异常:回落 DOM 并如实关掉开关 */
      }
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
  let detach = attachWebglRenderer(term, enabled);
  const off = subscribeSettings(() => {
    const next = getSettingsState().settings.terminalWebglRenderer;
    if (next === enabled) return;
    enabled = next;
    detach?.();
    detach = attachWebglRenderer(term, enabled);
  });
  return () => {
    off();
    detach?.();
  };
}
