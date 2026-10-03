/**
 * sessionHooks —— SessionScreen 的独立副作用(尺寸自适应 + 审批线徽标 + transcript
 * 实时生长),抽出以控组件复杂度。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@kernel/transport";
import type { TranscriptTurn } from "@kernel/transcript";
import { pollTranscript, resolveTranscriptPath } from "./sessionFile";

/** transcript 轮询周期:尺寸闸短路拍近零开销,2s 保证对话生长观感;
 * 写入侧 poke()(发送/应答成功后 300ms 补拍)消「白等下一拍」的迟滞。 */
const POLL_MS = 2000;
/** 写后补拍延迟:覆盖 CLI 收到输入 → jsonl 落盘的迟滞窗(立拍常读旧尾)。 */
const POKE_DELAY_MS = 300;

/** transcript 实时生长(spec 2026-09-25-mobile-session-render):定位 jsonl 后
 *  2s 一拍 pollTranscript(changed 才重解析 setState);后台标签页暂停拍但保活;
 *  非契约引擎持续重试定位(新会话 jsonl 懒落盘)。null = 尚无可解析对话,UI 回落实况。
 *  返回 poke:写入成功后把下一拍提前到 ~300ms(spec 2026-10-03-mobile-keybar-
 *  relayout),发消息/应答审批 ~0.3s 上屏而非白等 2s 拍;与在途拍竞态无害
 *  (pollTranscript 只读,size 台账末写胜出,append-only 源不重排)。 */
export function useLiveTurns(
  profileId: string | undefined,
  cwd: string | undefined,
  sessionKey: string,
  sinceMs?: number,
): { turns: TranscriptTurn[] | null; poke: () => void } {
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const pokeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!profileId || !cwd) {
      setTurns(null);
      pokeRef.current = null;
      return;
    }
    let alive = true;
    let path: string | null = null;
    let size: number | null = null;
    let timer = 0;
    /* 重入闸:tick 是 async(tick 内两个 await RPC 窗口);poke 若落在窗口内,
     * clearTimeout 清不到在途 tick(其 id 已触发),恢复后与 poke 排的新拍
     * 各自再排 → 轮询链翻倍累积(timer 只存最后一个 id,卸载前停不掉)。
     * 闸内 poke 改为「记一次提前」由 tick 出口统一排程(2026-10-03 二轮)。 */
    let ticking = false;
    let poked = false;
    setTurns(null);
    const tick = async () => {
      if (!alive || ticking) return;
      ticking = true;
      try {
        if (!document.hidden) {
          if (!path) path = await resolveTranscriptPath(profileId, cwd, sinceMs);
          if (path) {
            const next = await pollTranscript(path, size);
            if (!alive) return;
            if (next) {
              size = next.size;
              setTurns(next.turns);
            }
          }
        }
      } finally {
        ticking = false;
        if (alive) timer = window.setTimeout(tick, poked ? POKE_DELAY_MS : POLL_MS);
        poked = false;
      }
    };
    pokeRef.current = () => {
      if (!alive) return;
      if (ticking) {
        poked = true; /* 在途 tick 出口即按 POKE_DELAY_MS 接拍 */
        return;
      }
      clearTimeout(timer);
      timer = window.setTimeout(tick, POKE_DELAY_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      pokeRef.current = null;
    };
  }, [profileId, cwd, sessionKey, sinceMs]);
  const poke = useCallback(() => pokeRef.current?.(), []);
  return { turns, poke };
}

/** 审批线 chip:checkpoint_list(白名单只读)60s 轻拉;仅 (cwd,sessionId) 齐备时。 */
export function useCkptBadge(
  cwd: string | undefined,
  sessionId: string,
): { pending: number; approved: number } | null {
  const [ckpt, setCkpt] = useState<{ pending: number; approved: number } | null>(null);
  useEffect(() => {
    if (!cwd || !sessionId) return;
    const pull = () => {
      void invoke<{ id: string; open: boolean; state: string }[]>("checkpoint_list", {
        cwd,
        sessionId,
        tmdSessionId: sessionId,
      })
        .then((batches) => {
          const sealed = batches.filter((b) => !b.open);
          setCkpt({
            pending: sealed.filter((b) => b.state === "pending").length,
            approved: sealed.filter((b) => b.state === "approved").length,
          });
        })
        .catch(() => setCkpt(null));
    };
    pull();
    const timer = setInterval(pull, 60_000);
    return () => clearInterval(timer);
  }, [cwd, sessionId]);
  return ckpt;
}

/** 终端尺寸随容器自适应:量 .live 内容盒与字距算 cols/rows 调 session_resize;
 *  CLI 收 SIGWINCH 重排,活流 3s 尺寸轮询带新几何重建。仅在列数偏差 ≥2 时发,
 *  防键盘弹出等高度抖动引发重排风暴。 */
export function useTerminalFit(
  sessionId: string,
  liveRef: React.RefObject<HTMLElement | null>,
  liveShown: boolean,
) {
  const sentColsRef = useRef(0);
  useEffect(() => {
    if (!sessionId) return;
    let timer = 0;
    const fit = () => {
      const el = liveRef.current;
      if (!el || !el.clientWidth) return;
      const probe = document.createElement("span");
      probe.className = "tr-live";
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
      probe.textContent = "0".repeat(50);
      el.appendChild(probe);
      const rect = probe.getBoundingClientRect();
      const cw = rect.width / 50;
      const lh = rect.height || parseFloat(getComputedStyle(probe).lineHeight) || 16;
      probe.remove();
      const cs = getComputedStyle(el);
      const cols = Math.floor((el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / cw);
      const rows = Math.max(8, Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh) - 1);
      if (cols < 20 || Math.abs(cols - sentColsRef.current) < 2) return;
      sentColsRef.current = cols;
      void invoke("session_resize", { id: sessionId, cols, rows }).catch(() => undefined);
    };
    const debounced = () => {
      clearTimeout(timer);
      timer = window.setTimeout(fit, 300);
    };
    fit();
    window.addEventListener("resize", debounced);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", debounced);
    };
  }, [sessionId, liveShown, liveRef]);
}
