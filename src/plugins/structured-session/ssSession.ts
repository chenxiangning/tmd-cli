/**
 * 结构化会话生命周期 hook(从 sessionTab 拆出守 300 行铁则)——
 * PiRpcSession 全编排:spawn/握手/重试、转录 120ms 合帧、审批回路、
 * busy 排队(follow_up,引擎结算自动起跑)、轮次结束 OS 通知(PTY 侧
 * notifyOsTurnEnd 同闸同文案)、stderr 降噪(ready 期噪声不进状态行)。
 */
import { useEffect, useRef, useState } from "react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import type { CliTranscriptBlock } from "@kernel/cli";
import { sendOsNotification } from "@kernel/ipc";
import { openStructuredSessionTab, type StructuredSessionPayload } from "./tabs";
import { shouldNotify, notifyText } from "@plugins/notify/logic";
import { PiRpcSession, type PiRpcConfirm, type PiRpcModel, type PiRpcState } from "../cli-shared/piRpc";

export type Phase = "starting" | "ready" | "exited" | "error";

export function useSsSession(payload: StructuredSessionPayload) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<CliTranscriptBlock[]>([]);
  const [turnStart, setTurnStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [confirm, setConfirm] = useState<PiRpcConfirm | null>(null);
  const [model, setModel] = useState<PiRpcModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [draft, setDraft] = useState("");
  const sessionRef = useRef<PiRpcSession | null>(null);
  /* 贴底跟随标记(busy 流式期上翻停跟);scroll 副作用在组件侧读。 */
  const stickRef = useRef(true);
  /* stderr 尾行(ref 态)+ phase 镜像:onError 降噪闸(ready 期 stderr 不进状态行)。 */
  const phaseRef = useRef<Phase>("starting");
  const stderrTailRef = useRef<string | null>(null);
  /* 用户在途轮计数:send/followUp 记账,结算销账 —— 只有用户发起的轮次结束才发 OS 通知。 */
  const promptDebtRef = useRef(0);
  /* token 级 delta 30-80 事件/s:攒 120ms 尾沿合帧再进 React(流式观感无差,
   * 相位级 useMemo 与活块 markdown 重解析降频一个量级)。 */
  const pendingBlocksRef = useRef<[CliTranscriptBlock[], number] | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const flushBlocks = () => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingBlocksRef.current;
    if (pending) {
      pendingBlocksRef.current = null;
      setBlocks(pending[0]);
      setTurnStart(pending[1]);
    }
  };

  /* 生命周期:mount 起 RPC 子进程,unmount(关 tab)kill 收割。StrictMode 双跑
   * 由 startedRef 挡;失败先 kill 清残留子进程再进 error 态,重试按钮重跑启动。 */
  const startedRef = useRef(false);
  /* 断线接续态:retry 时已知 sessionId 且引擎声明 resumeArgs → --resume 换壳
   * 重开(引擎侧上下文保留),旧转录作 reducer 种子保形;否则全复位新会话。 */
  const resumeRef = useRef<string | null>(null);
  const seedRef = useRef<CliTranscriptBlock[] | null>(null);
  const startSession = () => {
    const rpc = host.getCliProfile(payload.profileId)?.structuredRpc;
    if (startedRef.current || !rpc) return;
    startedRef.current = true;
    setPhase("starting");
    setStatusText(null);
    let self: PiRpcSession;
    const session = (self = new PiRpcSession(
      rpc,
      payload.cwd,
      {
        onBlocks: (next, ts) => {
          pendingBlocksRef.current = [next, ts];
          if (flushTimerRef.current == null) {
            flushTimerRef.current = window.setTimeout(() => {
              flushTimerRef.current = null;
              flushBlocks();
            }, 120);
          }
        },
        onBusy: (b) => {
          setBusy(b);
          setBusySince(b ? Date.now() : null);
          if (!b) {
            /* 结算即销账 + 排队数回读(队列自动起跑的后续轮结算会再触发本路)。 */
            void sessionRef.current?.getState()
              .then((st) => setQueued(st?.queuedMessageCount ?? 0))
              .catch(() => undefined);
            if (promptDebtRef.current > 0) {
              promptDebtRef.current--;
              /* 轮次结束 OS 通知:PTY 侧同闸同文案(notifyOsTurnEnd + 失焦),点击深链回本 tab。 */
              const { settings } = getSettingsState();
              if (shouldNotify("turnEnd", settings, host.isWindowFocused())) {
                const name = `${host.getCliProfile(payload.profileId)?.name ?? payload.profileId} · ${t("结构化")}`;
                const { title, body } = notifyText("turnEnd", "", { getSessions: () => [] }, name);
                void sendOsNotification(title, body, () => openStructuredSessionTab(payload.profileId, payload.cwd));
              }
            }
          }
        },
        onConfirm: setConfirm,
        onExit: () => {
          if (sessionRef.current === self) {
            flushBlocks();
            setConfirm(null);
            setBusy(false);
            setBusySince(null);
            setPhase("exited");
          }
        },
        onError: (msg) => {
          /* stderr 降噪:只记尾行;ready 态不进状态行(展示窗口 = 启动/失败/终态)。 */
          stderrTailRef.current = msg;
          if (phaseRef.current !== "ready") setStatusText(msg);
        },
      },
      resumeRef.current && rpc.resumeArgs ? { resume: resumeRef.current, seedBlocks: seedRef.current ?? undefined } : undefined,
    ));
    sessionRef.current = session;
    void session
      .start()
      .then((state) => {
        if (sessionRef.current !== session) return;
        setSessionId(state?.sessionId ?? null);
        setModel(state?.model ?? null);
        setThinkingLevel(state?.thinkingLevel ?? null);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        /* 启动失败:先收割残留子进程,再进可重试的 error 态。 */
        session.kill();
        if (sessionRef.current === session) {
          sessionRef.current = null;
          setStatusText(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      });
  };
  const retry = () => {
    flushBlocks();
    const canResume = !!sessionId && !!host.getCliProfile(payload.profileId)?.structuredRpc?.resumeArgs;
    resumeRef.current = canResume ? sessionId : null;
    seedRef.current = canResume ? [...blocks] : null;
    sessionRef.current?.kill();
    sessionRef.current = null;
    startedRef.current = false;
    if (!canResume) {
      setBlocks([]);
      setTurnStart(0);
    }
    setQueued(0);
    setConfirm(null);
    setBusy(false);
    startSession();
  };
  useEffect(() => {
    startSession();
    return () => {
      startedRef.current = false;
      clearTimeout(flushTimerRef.current ?? undefined);
      sessionRef.current?.kill();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.profileId, payload.cwd]);

  /* working 头计时(monocode「working for Ns」同语义):busy 起跳,结算归零。 */
  useEffect(() => {
    if (busySince === null) return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - busySince) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busySince]);

  /* phase 镜像(onError 降噪闸读 ref,避免闭包滞留旧态)。 */
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const send = () => {
    const text = draft.trim();
    if (!text || phase !== "ready") return;
    const s = sessionRef.current;
    if (!s) return;
    setDraft("");
    stickRef.current = true;
    promptDebtRef.current++;
    /* busy 期发送 = follow_up 排队(引擎结算后自动起跑);闲时走 prompt。成功后回读排队数。 */
    void (busy ? s.followUp(text) : s.send(text))
      .then(() => s.getState())
      .then((st) => setQueued(st?.queuedMessageCount ?? 0))
      .catch((e: unknown) => {
        setStatusText(e instanceof Error ? e.message : String(e));
        /* 发送失败保输入(桌面契约):仅在用户未另起输入时回填;记账同笔回滚。 */
        promptDebtRef.current = Math.max(0, promptDebtRef.current - 1);
        setDraft((d) => (d === "" ? text : d));
      });
  };
  /* 审批应答(ConfirmCard 回路):应答即收卡,重复应答按无 confirm 短路。 */
  const answerConfirm = (ok: boolean) => {
    const cur = confirm;
    if (!cur) return;
    sessionRef.current?.respond(cur.frameId, ok);
    setConfirm(null);
  };

  /** 模型/思考级菜单动作后的权威态回写(SsHeader → hook 状态)。 */
  const onStateRefresh = (s: PiRpcState) => {
    setModel(s.model ?? null);
    setThinkingLevel(s.thinkingLevel ?? null);
  };

  return {
    phase, statusText, blocks, turnStart, busy, elapsed, confirm,
    model, thinkingLevel, sessionId, queued, draft, setDraft,
    sessionRef, stickRef, retry, send, answerConfirm, onStateRefresh,
  };
}
