/**
 * 会话活流 hook:PTY 字节喂 LiveScreen 迷你 VT 视口(固定 H×W + 触底上滚)。
 * - 先订阅后快照(二轮 P1-2):反序会留流中段缺口;缓冲后按序排空,重复窗仅
 *   服务端「订阅生效→快照读取」毫秒级,远优于任意长缺口 + ANSI 劈裂。
 * - 尺寸与首页并行拉(外网 RTT 减半);首页 128KB:回看深度一步到位(分页帧
 *   远低于中继 4MiB 上限)。
 * - loadEarlier:复用 session_history_page 分页(start_offset/has_more 桌面现成),
 *   剥 ANSI 线性文本前置渲染——LiveScreen 是 append-only VT 模型,不可前插字节。
 * - 尺寸:手机 useTerminalFit 随容器发 session_resize(与桌面共享同一 PTY),
 *   每 3s 校 session_size,变了即 LiveScreen 原地 resize(不重放快照:重放会把
 *   在途活 chunk 与快照字节双喂;真机双页脚实证的是几何,不是重放)。
 * - 内容零丢失(P0):事件跳帧(Lagged)与断连重连(onRemoteConnection 翻转)
 *   都按水位比对触发一次 rebuild 回放 —— 断连窗口的输出不再成永久缺口。水位 =
 *   尾页 start_offset+text.length,实况 chunk 到达即累加;回放期间新 chunk 进
 *   缓冲换屏后排空(与首载同一套序),免换屏竞态丢字节。
 * - rAF 脏标合帧 → 100ms 尾沿节流(spec 2026-10-03-mobile-keybar-relayout):
 *   全量 view() 重建压到 ~10Hz,文本视口观感仍瞬时,WKWebView 全文重排次数
 *   较 60Hz 降约 6 倍;尾沿保证最后一帧必达。
 * - useSessionExit:pty://exit 订阅 + 列表消失兜底(会话屏终局横幅的数据面)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, onEventGap, onRemoteConnection } from "@kernel/transport";
import { stripAnsi } from "@kernel/askDetect";
import { LiveScreen } from "./liveText";
import { onPtyOut } from "./remote";

const PAGE_BYTES = 128 * 1024;

/** setLive 尾沿节流间隔:文本视口 10Hz 观感瞬时(人眼对纯文本更新 ~70ms 起感)。 */
const LIVE_FLUSH_MS = 100;

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
    let connOff: (() => void) | null = null;
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
      /* 内容水位(字符近似):尾页 total / 实况 chunk 累加;断连重连后比对,
       * 涨了 = 断连窗口有漏 → 回放。多字节字符下有轻漂移,容忍:漏报回落旧
       * 行为(下轮 3s 几何校准兜不住则维持缺口),多报只是一次多余回放。 */
      let watermark = 0;
      /* 首载完成闸:未完不回放(首载本身就是全量拉尾,抢跑会双喂)。 */
      let ready = false;
      /* 合帧节流(spec 2026-10-03):flushTimer 在途 = 已有排程,新 chunk 只喂屏
       * 不再排;flush 时取全量 view()。尾沿必达——最后一帧总在距上次上屏
       * ≥100ms 处落屏,不存在丢尾。 */
      let lastSetAt = 0;
      let flushTimer = 0;
      const flushView = () => {
        flushTimer = 0;
        lastSetAt = Date.now();
        if (alive) setLive(screen.view());
      };
      const feedChunk = (chunk: string) => {
        watermark += chunk.length;
        screen.feed(chunk);
        if (flushTimer) return;
        const wait = LIVE_FLUSH_MS - (Date.now() - lastSetAt);
        flushTimer = window.setTimeout(flushView, Math.max(0, wait));
      };
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
        watermark = page.start_offset + page.text.length;
        earliestRef.current = page.start_offset;
        setHasMore(page.has_more);
      }
      streaming = true;
      setLive(screen.view());
      for (const chunk of buffered) feedChunk(chunk);
      buffered.length = 0;
      ready = true;
      const sizeKey = { current: size ? `${size[0]}x${size[1]}` : "" };
      const rebuild = () => {
        if (!alive) return;
        void (async () => {
          const s = await sizeOf();
          if (!alive || !s) return;
          const key = `${s[0]}x${s[1]}`;
          if (key === sizeKey.current) return;
          sizeKey.current = key;
          /* 原地改几何,不重放快照:pageOf 在途窗口的活 chunk 会与快照字节
           * 双喂(旧实现在此把同一帧画两份)。旧宽换行由 CSS pre-wrap 兜底,
           * CLI 的 WINCH 全帧重绘按新几何收敛。 */
          screen.resize(s[0], s[1]);
          setLive(screen.view());
        })();
      };
      /* 断连重连 / 事件 Lagged 回放:拉尾页比对水位,涨了 = 有漏 → 按当前几何
       * 重建重放日志尾;没涨 = 什么都不漏,免重建。回放期间 streaming 关闭,新
       * chunk 进缓冲;重建分支丢弃在途缓冲——快照已含的字节排空即同一帧画两份
       * (旧版每次断连必现),而快照读取后才写入的字节会随之丢一拍(窄竞态,
       * 非零概率),由水位比对在下次 gap/重连回放自愈,两害取轻;不重建分支
       * 照常排空(屏未重喂,缓冲是唯一拷贝)。 */
      let replaying = false;
      const replay = () => {
        if (!alive || replaying || !ready) return;
        replaying = true;
        streaming = false;
        void (async () => {
          const p = await pageOf(Number.MAX_SAFE_INTEGER);
          const s = p ? await sizeOf() : null;
          if (alive && p && s && p.start_offset + p.text.length > watermark) {
            sizeKey.current = `${s[0]}x${s[1]}`;
            screen = new LiveScreen(s[0], s[1]);
            screen.feed(p.text);
            watermark = p.start_offset + p.text.length;
            setLive(screen.view());
            buffered.length = 0;
          }
          if (!alive) return;
          streaming = true;
          for (const chunk of buffered) feedChunk(chunk);
          buffered.length = 0;
          replaying = false;
        })();
      };
      gapOff = onEventGap(replay);
      connOff = onRemoteConnection((st) => {
        if (st.connected) replay();
      });
      timer = window.setInterval(rebuild, 3000);
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      off?.();
      gapOff?.();
      connOff?.();
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

/** 会话退出订阅(conn.rs event_allowed 已放行 pty://exit/{id})+ 列表消失
 *  兜底:订阅生效前进程已死会错过事件 → 轮询发现会话不在列表也视为退出
 *  (须先见过它在表:防「刚 spawn 尚未入表」误判)。onExit 两条路合计恰一次。 */
export function useSessionExit(
  sessionId: string | undefined,
  sessions: { id: string }[],
  onExit: () => void,
): void {
  const cb = useRef(onExit);
  /* 最新回调对齐移入 effect(渲染期写 ref 破坏 render 纯性):每次 commit 后
     同步,cb.current() 只在订阅/轮询事件里调用,读到的恒是最新一帧闭包。 */
  useEffect(() => {
    cb.current = onExit;
  });
  const firedRef = useRef(false);
  const seenRef = useRef(false);
  const fire = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    cb.current();
  };
  useEffect(() => {
    firedRef.current = false;
    seenRef.current = false;
    if (!sessionId) return;
    let alive = true;
    let off: (() => void) | null = null;
    void listen<{ code: number | null }>(`pty://exit/${sessionId}`, () => {
      if (alive) fire();
    })
      .then((f) => {
        if (alive) off = f;
        else f();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off?.();
    };
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || firedRef.current) return;
    if (sessions.some((s) => s.id === sessionId)) {
      seenRef.current = true;
      return;
    }
    if (seenRef.current) fire();
  }, [sessions, sessionId]);
}
