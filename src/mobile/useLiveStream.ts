/**
 * 会话活流 hook:PTY 字节喂 LiveScreen 迷你 VT 视口(固定 H×W + 触底上滚)。
 * - 先订阅后快照(二轮 P1-2):反序会留流中段缺口;缓冲后按序排空。订阅生效
   →快照读取窗口内到达的 chunk 会与快照字节重叠,排空前按「快照尾 ∩ 缓冲头」
   剥离(overlapLen),差分重绘型 CLI(opencode)对双喂不幂等,重复即上屏。
 * - 尺寸与首页并行拉(外网 RTT 减半);首页 128KB 回看深度一步到位;每 3s
 *   校 session_size 变了即原地 resize(不重放快照,防双喂)。
 * - loadEarlier:复用 session_history_page 分页,剥 ANSI 前置渲染(append-only
 *   VT 模型不可前插字节);Lagged/断连重连按水位触发 replay 回放。
 * - setLive 100ms 合帧节流(spec 2026-10-03):WKWebView 重排降约 6 倍,尾沿必达。
 * - useSessionExit:pty://exit 订阅 + 列表消失兜底(会话屏终局横幅的数据面)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, onEventGap, onRemoteConnection } from "@kernel/transport";
import { stripAnsi } from "@kernel/askDetect";
import { LiveScreen } from "./liveText";
import { onPtyOut } from "./remote";

/** 快照尾与缓冲前缀的重叠字节长:排空缓冲前剥掉已含于快照的前缀(双喂防线,
 * 纯函数,测试锚定)。上限 4KB 止损;最长后缀匹配 = 真实重叠(到达序 = 发射序,
 * 快照读取前到达的必为缓冲前缀);短窗偶合误剥至多几字符,远轻于整段双喂。 */
export function overlapLen(tail: string, pending: string): number {
  const max = Math.min(tail.length, pending.length, 4096);
  for (let k = max; k > 0; k--) if (tail.endsWith(pending.slice(0, k))) return k;
  return 0;
}

/** streaming 关闭期缓冲丢头保尾压到上限内(纯函数,测试锚定;0.4.6 复审 P2:
 * 无上限攒 chunk 可致 WKWebView 回收;丢头无害——反正由 replay 重建覆盖)。 */
export function capBuffered(chunks: string[], maxLen: number): string[] {
  let len = chunks.reduce((s, c) => s + c.length, 0);
  const out = [...chunks];
  while (len > maxLen && out.length > 1) len -= out.shift()!.length;
  return out;
}

const PAGE_BYTES = 128 * 1024;

/** streaming 关闭期缓冲总量上限(字符近似;超限丢头保尾,replay 重建覆盖)。 */
const BUFFERED_MAX_CHARS = 2 * 1024 * 1024;

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
    /* 尾沿节流 + 弱网退避排程句柄:effect 作用域声明,cleanup 可即撤(复审 P2)。 */
    let flushTimer = 0;
    let retryTimer = 0;
    setLive("");
    setEarlier("");
    setHasMore(false);
    earliestRef.current = 0;
    void (async () => {
      type HistPage = { text: string; start_offset: number; has_more: boolean };
      const sizeOf = () => invoke<[number, number] | null>("session_size", { id: sessionId }).catch(() => null);
      const pageOf = (before: number) =>
        invoke<HistPage>("session_history_page", { id: sessionId, before, maxBytes: PAGE_BYTES }).catch(() => null);
      const buffered: string[] = [];
      let bufferedLen = 0;
      const pushBuffered = (chunk: string) => {
        buffered.push(chunk);
        if (bufferedLen + chunk.length <= BUFFERED_MAX_CHARS) {
          bufferedLen += chunk.length;
          return;
        }
        const kept = capBuffered(buffered, BUFFERED_MAX_CHARS);
        buffered.length = 0;
        buffered.push(...kept);
        bufferedLen = kept.reduce((s, c) => s + c.length, 0);
      };
      let streaming = false;
      let screen = new LiveScreen(undefined, undefined);
      /* 内容水位(字符近似,漂移容忍):重连后比对,涨了 = 有漏 → 回放。 */
      let watermark = 0;
      /* 首载完成闸:未完不回放(抢跑会双喂);合帧节流:flush 取全量 view(),尾沿必达。 */
      let ready = false;
      let lastSetAt = 0;
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
        else pushBuffered(chunk);
      });
      if (!alive) { un(); return; } /* 竞态:await 在途卸载 → 到站即退订,防桥内滞留 */
      off = un;
      /* 尺寸+首页并行;首载尾页失败弱网退避重拉(2s/5s 最多 2 次,复审 P2)。 */
      const [size, page0] = await Promise.all([sizeOf(), pageOf(Number.MAX_SAFE_INTEGER)]);
      let page = page0;
      /* 首载退避重拉 2s/5s 各一次(展开不走循环,react-doctor);等待窗卸载即出。 */
      const backoff = (ms: number) => { const { promise, resolve } = Promise.withResolvers<void>(); retryTimer = window.setTimeout(resolve, ms); return promise; };
      if (!page && alive) { await backoff(2000); }
      if (!page && alive) page = await pageOf(Number.MAX_SAFE_INTEGER);
      if (!page && alive) { await backoff(5000); }
      if (!page && alive) page = await pageOf(Number.MAX_SAFE_INTEGER);
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
      {
        const pending = buffered.join("");
        buffered.length = 0;
        bufferedLen = 0;
        const k = page ? overlapLen(page.text, pending) : 0;
        if (pending.length > k) feedChunk(pending.slice(k));
      }
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
           * 双喂(旧实现在此把同一帧画两份)。缩列截断见 LiveScreen.resize。 */
          screen.resize(s[0], s[1]);
          setLive(screen.view());
        })();
      };
      /* 断连重连 / Lagged 回放:拉尾页比对水位,涨了 = 重建重放日志尾。
       * 回放期间新 chunk 进缓冲,重建后经 overlapLen 剥离排空(防双喂)。 */
      let replaying = false;
      /* 弱网退避:拉取失败 2s/5s 两拍重试;两拍失败维持 streaming=false,等下一
       * gap/重连边沿。replayTries 清零收敛在成功尾路一处(复审 shrink)。 */
      let replayTries = 0;
      const replay = () => {
        if (!alive || replaying || !ready) return;
        replaying = true;
        streaming = false;
        void (async () => {
          try {
            const p = await pageOf(Number.MAX_SAFE_INTEGER).catch(() => null);
            const s = p ? await sizeOf().catch(() => null) : null;
            if (alive && p && s && p.start_offset + p.text.length > watermark) {
              sizeKey.current = `${s[0]}x${s[1]}`;
              screen = new LiveScreen(s[0], s[1]);
              screen.feed(p.text);
              watermark = p.start_offset + p.text.length;
              setLive(screen.view());
            }
            if (!alive) return;
            if (!p) {
              if (replayTries < 2) {
                replayTries += 1;
                retryTimer = window.setTimeout(replay, replayTries === 1 ? 2000 : 5000);
              } else {
                replayTries = 0; /* 放弃本边沿:buffered 继续攒,等下一 gap/重连再试 */
              }
              return;
            }
            replayTries = 0;
            streaming = true;
            const pending = buffered.join("");
            buffered.length = 0;
            bufferedLen = 0;
            const k = overlapLen(p.text, pending);
            if (pending.length > k) feedChunk(pending.slice(k));
          } finally {
            replaying = false;
          }
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
      clearTimeout(flushTimer); /* 卸载即撤尾沿排程(alive 闸下虽是 no-op,不留空转定时器) */
      clearTimeout(retryTimer); /* 弱网退避排程同撤 */
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
