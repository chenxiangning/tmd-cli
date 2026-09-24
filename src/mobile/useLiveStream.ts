/**
 * 会话活流 hook:PTY 字节喂 LiveScreen 迷你 VT 视口(固定 H×W + 触底上滚)。
 * - 先订阅后快照(二轮 P1-2):反序会留流中段缺口;缓冲后按序排空,重复窗仅
 *   服务端「订阅生效→快照读取」毫秒级,远优于任意长缺口 + ANSI 劈裂。
 * - 尺寸归桌面 xterm 独占(手机从不 resize),拖面板后旧模型 CUP 钳位错位 →
 *   每 3s 校 session_size,变了即按新几何重建 + 重放日志尾(真机双页脚实证);
 *   事件跳帧(Lagged)同路立即重建。
 * - rAF 脏标合帧:全量 view() 重建压到 ≤60Hz。
 */
import { useEffect, useState } from "react";
import { invoke, onEventGap } from "@kernel/transport";
import { LiveScreen } from "./liveText";
import { onPtyOut } from "./remote";

export function useLiveStream(sessionId: string | undefined): string {
  const [live, setLive] = useState("");
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let off: (() => void) | null = null;
    let gapOff: (() => void) | null = null;
    let timer = 0;
    setLive("");
    void (async () => {
      const sizeOf = () =>
        invoke<[number, number] | null>("session_size", { id: sessionId }).catch(() => null);
      const pageOf = () =>
        invoke<{ text: string }>("session_history_page", {
          id: sessionId,
          before: Number.MAX_SAFE_INTEGER,
          maxBytes: 32_000,
        }).catch(() => null);
      const size = await sizeOf();
      if (!alive) return;
      let sizeKey = size ? `${size[0]}x${size[1]}` : "";
      const buffered: string[] = [];
      let streaming = false;
      let screen = new LiveScreen(size?.[0], size?.[1]);
      const feedChunk = (chunk: string) => {
        screen.feed(chunk);
        if (dirty) return;
        dirty = true;
        requestAnimationFrame(() => {
          dirty = false;
          if (alive) setLive(screen.view());
        });
      };
      let dirty = false;
      const un = await onPtyOut(sessionId, (chunk) => {
        if (!alive) return;
        if (streaming) feedChunk(chunk);
        else buffered.push(chunk);
      });
      if (!alive) { un(); return; } /* 竞态:await 在途卸载 → 到站即退订,防桥内滞留 */
      off = un;
      const page = await pageOf();
      if (!alive) return;
      if (page?.text) screen.feed(page.text);
      streaming = true;
      if (page?.text) setLive(screen.view());
      for (const chunk of buffered) feedChunk(chunk);
      buffered.length = 0;
      const rebuild = () => {
        if (!alive) return;
        void (async () => {
          const s = await sizeOf();
          if (!alive || !s) return;
          const key = `${s[0]}x${s[1]}`;
          if (key === sizeKey) return;
          sizeKey = key;
          screen = new LiveScreen(s[0], s[1]);
          const p = await pageOf();
          if (!alive) return;
          if (p?.text) screen.feed(p.text);
          setLive(screen.view());
        })();
      };
      gapOff = onEventGap(rebuild);
      timer = window.setInterval(rebuild, 3000);
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      off?.();
      gapOff?.();
    };
  }, [sessionId]);
  return live;
}
