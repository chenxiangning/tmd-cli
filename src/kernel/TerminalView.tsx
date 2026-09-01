/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流（幕布零渲染原则的唯一实现点）。
 *
 * 生命周期：挂载 → 回放内核输出缓冲（切回不黑屏）→ 订阅实时总线。
 * 输入路径：xterm onData 直写 PTY；富 composer 实装后汇入同一条 write 通道。
 */

import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import { host, ptyLiveTopic } from "@kernel/host";
import { subscribeThemeApplied } from "@kernel/theme";

/** 从文档计算样式读终端 token → xterm theme(主题引擎已内联最新值)。 */
function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim() || undefined;
  return {
    background: read("--tmd-terminal-bg"),
    foreground: read("--tmd-terminal-fg"),
    cursor: read("--tmd-terminal-cursor"),
    selectionBackground: read("--tmd-terminal-selection"),
  };
}

export function TerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* 终端等宽字体按平台区分:mac 用 Menlo 系,Windows 用 Cascadia/Consolas,Linux 用 DejaVu/Liberation。 */
    const fontFamily =
      getPlatformKind() === "windows"
        ? "'Cascadia Mono', Consolas, 'Courier New', monospace"
        : getPlatformKind() === "linux"
          ? "'DejaVu Sans Mono', 'Liberation Mono', monospace"
          : "Menlo, Monaco, 'Courier New', monospace";
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily,
      theme: readTerminalTheme(),
    });
    /* 主题切换 → 重刷 xterm 配色(纯视觉重着色,字节流内容不受影响)。 */
    const offTheme = subscribeThemeApplied(() => {
      term.options.theme = readTerminalTheme();
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    // 先回放历史输出，再挂实时流——顺序保证字节流连续
    const replay = host.getOutputBuffer(sessionId);
    if (replay) term.write(replay);

    const offLive = host.events.on<string>(ptyLiveTopic(sessionId), (text) =>
      term.write(text),
    );
    const offInput = term.onData((data) => void ipc.sessionWrite(sessionId, data));

    const syncSize = () => {
      fit.fit();
      void ipc.sessionResize(sessionId, term.cols, term.rows);
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      offTheme();
      offLive();
      offInput.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
