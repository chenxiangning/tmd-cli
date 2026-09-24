/**
 * 会话活流 hook:PTY 字节喂 LiveScreen 迷你 VT 视口(固定 H×W + 触底上滚)。
 * - 先订阅后快照(二轮 P1-2):反序会留流中段缺口;缓冲后按序排空,重复窗仅
 *   服务端「订阅生效→快照读取」毫秒级,远优于任意长缺口 + ANSI 劈裂。
 * - 尺寸与首页并行拉(外网 RTT 减半);首页 128KB:回看深度一步到位(分页帧
 *   远低于中继 4MiB 上限)。
 * - loadEarlier:复用 session_history_page 分页(start_offset/has_more 桌面现成),
 *   剥 ANSI 线性文本前置渲染——LiveScreen 是 append-only VT 模型,不可前插字节。
 * - 尺寸归桌面 xterm 独占(手机从不 resize),拖面板后旧模型 CUP 钳位错位 →
 *   每 3s 校 session_size,变了即按新几何重建 + 重放日志尾(真机双页脚实证);
 *   事件跳帧(Lagged)同路立即重建。
 * - rAF 脏标合帧:全量 view() 重建压到 ≤60Hz。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, onEventGap } from "@kernel/transport";
import { stripAnsi } from "@kernel/askDetect";
import { LiveScreen } from "./liveText";
import { onPtyOut } from "./remote";

const PAGE_BYTES = 128 * 1024;

export interface LiveStream {
  live: string;
  /** 更早历史(剥 ANSI,按取回顺序拼接;渲染在实况区上方)。 */
  earlier: string;
  hasMore: boolean;
  loadingEarlier: boolean;
  loadEarlier: () => void;
}

export function useLiveStream(sessionId: string | undefined): LiveStream {
  const [live, setLive] = useState("");
  const [earlier, setEarlier] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const earliestRef = useRef(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let off: (() => void) | null = null;
    let gapOff: (() => void) | null = null;
    let timer = 0;
    setLive("");
    setEarlier("");
    setHasMore(false);
    earliestRef.current = 0;
    void (async () => {
      const sizeOf = () =>
        invoke<[number, number] | null>("session_size", { id: sessionId }).catch(() => null);
      const pageOf = (before: number) =>
        invoke<{ text: string; start_offset: number; has_more: boolean }>("session_history_page", {
          id: sessionId,
          before,
          maxBytes: PAGE_BYTES,
        }).catch(() => null);
      const buffered: string[] = [];
      let streaming = false;
      let screen = new LiveScreen(undefined, undefined);
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
      /* 尺寸+首页并行(外网省一个串行 RTT);首页定回看起点。 */
      const [size, page] = await Promise.all([sizeOf(), pageOf(Number.MAX_SAFE_INTEGER)]);
      if (!alive) return;
      if (size) screen = new LiveScreen(size[0], size[1]);
      if (page) {
        screen.feed(page.text);
        earliestRef.current = page.start_offset;
        setHasMore(page.has_more);
      }
      streaming = true;
      setLive(screen.view());
      for (const chunk of buffered) feedChunk(chunk);
      buffered.length = 0;
      const sizeKey = { current: size ? `${size[0]}x${size[1]}` : "" };
      const rebuild = () => {
        if (!alive) return;
        void (async () => {
          const s = await sizeOf();
          if (!alive || !s) return;
          const key = `${s[0]}x${s[1]}`;
          if (key === sizeKey.current) return;
          sizeKey.current = key;
          screen = new LiveScreen(s[0], s[1]);
          const p = await pageOf(Number.MAX_SAFE_INTEGER);
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

  const loadEarlier = useCallback(() => {
    if (!sessionId || loadingRef.current || earliestRef.current <= 0) return;
    loadingRef.current = true;
    setLoadingEarlier(true);
    void invoke<{ text: string; start_offset: number; has_more: boolean }>("session_history_page", {
      id: sessionId,
      before: earliestRef.current,
      maxBytes: PAGE_BYTES,
    })
      .then((page) => {
        if (!page) return;
        earliestRef.current = page.start_offset;
        setHasMore(page.has_more);
        if (page.text) {
          const text = stripAnsi(page.text).replace(/^\n+/, "");
          setEarlier((old) => (text ? text + "\n" : "") + old);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        loadingRef.current = false;
        setLoadingEarlier(false);
      });
  }, [sessionId]);

  return { live, earlier, hasMore, loadingEarlier, loadEarlier };
}
