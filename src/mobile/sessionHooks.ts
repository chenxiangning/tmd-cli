/**
 * sessionHooks —— SessionScreen 的独立副作用(尺寸自适应 + 审批线徽标 + transcript
 * 实时生长),抽出以控组件复杂度。
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@kernel/transport";
import type { TranscriptTurn } from "@kernel/transcript";
import { pollTranscript, resolveTranscriptPath } from "./sessionFile";

/** transcript 轮询周期:尺寸闸短路拍近零开销,2s 保证对话生长观感。 */
const POLL_MS = 2000;

/** transcript 实时生长(spec 2026-09-25-mobile-session-render):定位 jsonl 后
 *  2s 一拍 pollTranscript(changed 才重解析 setState);后台标签页暂停拍但保活;
 *  非契约引擎持续重试定位(新会话 jsonl 懒落盘)。null = 尚无可解析对话,UI 回落实况。 */
export function useLiveTurns(
  profileId: string | undefined,
  cwd: string | undefined,
  sessionKey: string,
): TranscriptTurn[] | null {
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  useEffect(() => {
    if (!profileId || !cwd) {
      setTurns(null);
      return;
    }
    let alive = true;
    let path: string | null = null;
    let size: number | null = null;
    let timer = 0;
    setTurns(null);
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        if (!path) path = await resolveTranscriptPath(profileId, cwd);
        if (path) {
          const next = await pollTranscript(path, size);
          if (!alive) return;
          if (next) {
            size = next.size;
            setTurns(next.turns);
          }
        }
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [profileId, cwd, sessionKey]);
  return turns;
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
