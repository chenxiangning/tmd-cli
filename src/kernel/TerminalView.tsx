/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流（幕布零渲染原则的唯一实现点）。
 *
 * 生命周期：挂载 → 回放内核输出缓冲（切回不黑屏）→ 订阅实时总线。
 * 输入路径：xterm onData 直写 PTY；富 composer 实装后汇入同一条 write 通道。
 */

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@kernel/ipc";
import { host, ptyLiveTopic } from "@kernel/host";

export function TerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
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
      offLive();
      offInput.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
