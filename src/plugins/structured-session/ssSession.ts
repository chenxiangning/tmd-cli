/**
 * 结构化会话生命周期 hook —— PiRpcSession 全编排:spawn/收养/握手/重试、
 * 转录 120ms 合帧、审批回路、follow_up 排队、轮末 OS 通知、看门狗、
 * warn 多槽(ssWarn)、stderr 降噪。
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { errTextDisplay } from "@kernel/errText";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import type { CliTranscriptBlock } from "@kernel/cli";
import { sendOsNotification } from "@kernel/ipc";
import { isSsMuted, noteLastSsSession, noteSsRpcSession, focusStructuredSessionTab, type StructuredSessionPayload } from "@kernel/structuredSessionTabs";
import { adoptDiskSeed, cancelAdoptKill, scheduleAdoptKill } from "./adoptBoot";
import { shouldNotify, notifyText } from "@plugins/notify/logic";
import { useTurnWatchdog } from "./ssWatchdog";
import { useWarnCapsules } from "./ssWarn";
import { useSsDraft } from "./ssDraft";
import { PiRpcSession, type PiLiveSurface, type PiRpcConfirm, type PiRpcModel, type PiRpcState, type PiRpcStats } from "../cli-shared/piRpc";
import { StructuredTurnEvidence } from "./evidence";
import { useTurnLive } from "./ssTurnLive";

export type Phase = "starting" | "ready" | "exited" | "error";

/** 轮次结束 OS 通知:PTY 侧同闸同文案;RPC 行静音覆盖层(isSsMuted)先行;点击深链回本 tab。 */
function notifyTurnEnd(profileId: string, cwd: string, tabId: string): void {
  const { settings } = getSettingsState();
  if (isSsMuted(profileId, cwd) || !shouldNotify("turnEnd", settings, host.isWindowFocused(), settings)) return;
  const name = `${host.getCliProfile(profileId)?.name ?? profileId} · ${t("带渲染的会话")}`;
  const { title, body } = notifyText("turnEnd", "", { getSessions: () => [] }, name);
  void sendOsNotification(title, body, () => focusStructuredSessionTab(tabId, profileId, cwd));
}

/** useSsSession 返回面(StructuredSessionTab 与子组件的共享契约)。 */
export type SsSessionState = {
  phase: Phase; statusText: string | null; warns: string[]; blocks: CliTranscriptBlock[]; turnStart: number;
  busy: boolean; busySince: number | null; elapsed: number; confirm: PiRpcConfirm | null;
  model: PiRpcModel | null; thinkingLevel: string | null; sessionId: string | null;
  queued: number; stats: PiRpcStats | null; draft: string; setDraft: Dispatch<SetStateAction<string>>;
  /** 流内活跃输出面(活思考/正文据此展开;与块位置无关,见 PiRpcReducer.liveSurface)。 */
  liveSurface: PiLiveSurface;
  /** 轮进行中渲染态(结算 600ms 宽限,见 useTurnLive;与 busy 分离,引擎逐步发 session_settled)。 */
  turnLive: boolean;
  sessionRef: MutableRefObject<PiRpcSession | null>; stickRef: MutableRefObject<boolean>;
  retry: () => void; send: () => void; answerConfirm: (ok: boolean) => void; onStateRefresh: (s: PiRpcState) => void;
  dismissWarn: (index: number) => void;
};

export function useSsSession(payload: StructuredSessionPayload, ledgerId: string): SsSessionState {
  const [phase, setPhase] = useState<Phase>("starting");
  const [statusText, setStatusText] = useState<string | null>(null);
  const { warns, addWarn, dismissWarn, clearWarns } = useWarnCapsules();
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
  const [stats, setStats] = useState<PiRpcStats | null>(null);
  const [draft, setDraft] = useSsDraft(payload.profileId, payload.cwd);
  const sessionRef = useRef<PiRpcSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [evidence] = useState(() => new StructuredTurnEvidence(payload.cwd, ledgerId));
  const turnLive = useTurnLive();
  const stickRef = useRef(true);
  const phaseRef = useRef<Phase>("starting"); const stderrTailRef = useRef<string | null>(null);
  const promptDebtRef = useRef(0); // 用户在途轮计数:send/followUp 记账结算销账,只有用户轮结束才发 OS 通知
  /* token delta 30-80 事件/s:攒 120ms 尾沿合帧再进 React(重解析降一个量级)。 */
  const pendingBlocksRef = useRef<[CliTranscriptBlock[], number, PiLiveSurface] | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const [liveSurface, setLiveSurface] = useState<PiLiveSurface>(null);
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
      setLiveSurface(pending[2]);
    }
  };
  /* 生命周期:mount 起子进程,unmount kill 收割(StrictMode 双跑 startedRef 挡;收养流延迟收割见 adoptBoot)。 */
  const startedRef = useRef(false);
  const { stamp } = useTurnWatchdog(busy, t("引擎超过 5 分钟无输出,可能已僵死;可中止或重试"), addWarn);
  const resumeRef = useRef<string | null>(null); const seedRef = useRef<CliTranscriptBlock[] | null>(null); const seedKeepRef = useRef(true);
  const dropResumeRef = useRef(false); // resume 目标已判 not found(降级新建,只降一次防循环)
  const startSession = () => {
    const rpc = host.getCliProfile(payload.profileId)?.structuredRpc;
    if (startedRef.current || !rpc) return;
    startedRef.current = true;
    setPhase("starting");
    setStatusText(null);
    clearWarns();
    stderrTailRef.current = null;
    let self: PiRpcSession;
    /* 收养流:第二遍挂载接管同流,取消上一遍 cleanup 的待决 kill(评审 P2)。 */
    if (payload.adoptStreamId) cancelAdoptKill(payload.adoptStreamId);
    const session = (self = new PiRpcSession(
      rpc,
      payload.cwd,
      {
        onBlocks: (next, ts, surface) => {
          stamp();
          pendingBlocksRef.current = [next, ts, surface];
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
          if (b) turnLive.begin();
          else turnLive.end();
          if (b) {
            if (sessionIdRef.current) evidence.agentStart(sessionIdRef.current);
          } else {
            evidence.settled();
            void sessionRef.current?.getState()
              .then((st) => setQueued(st?.queuedMessageCount ?? 0))
              .catch(() => undefined);
            void sessionRef.current?.getStats().then((s) => { if (s) setStats(s); }).catch(() => undefined);
            if (promptDebtRef.current > 0) {
              promptDebtRef.current--;
              notifyTurnEnd(payload.profileId, payload.cwd, ledgerId);
            }
          }
        },
        onToolExecution: (rec) => evidence.toolExecution(rec),
        onConfirm: setConfirm,
        onDroppedFrame: () => addWarn(t("RPC 流有帧被截断丢弃,转录可能缺块")),
        onExit: () => {
          if (sessionRef.current === self) {
            /* 存证封口:进程退出 = 轮次永不再结算,悬锚 seal。 */
            void evidence.settled();
            flushBlocks();
            setConfirm(null);
            setBusy(false);
            setBusySince(null);
            turnLive.reset();
            setPhase("exited");
          }
        },
        onError: (msg) => {
          /* stderr 降噪:只记尾行;ready 态不进状态行,启动期首条另存 warn 胶囊。 */
          stderrTailRef.current = msg;
          if (phaseRef.current !== "ready") {
            setStatusText(msg);
            addWarn(msg);
          }
        },
      },
      payload.adoptStreamId
        ? { adoptStreamId: payload.adoptStreamId }
        : { resume: dropResumeRef.current ? undefined : payload.resumeSessionId ?? (resumeRef.current && rpc.resumeArgs ? resumeRef.current : undefined), seedBlocks: seedRef.current ?? undefined, seedKeepTail: seedKeepRef.current, spawnLabel: ledgerId },
    ));
    sessionRef.current = session;
    void session
      .start()
      .then((state) => {
        if (sessionRef.current !== session) return;
        setSessionId(state?.sessionId ?? null);
        sessionIdRef.current = state?.sessionId ?? null;
        setModel(state?.model ?? null);
        setThinkingLevel(state?.thinkingLevel ?? null);
        /* ready 即清启动期状态行(陈旧 stderr 不挂 header);warn 胶囊独立保留。 */
        setStatusText(null);
        setPhase("ready");
        /* adopt/resume 后置种子:磁盘转录补历史(读不到静默空幕布;候选 id 握手 sid
         * 优先,引擎换壳 sid 变化时回落请求的 resumeSessionId)。 */
        if (payload.adoptStreamId || payload.resumeSessionId) void adoptDiskSeed(session, payload, state?.sessionId, payload.resumeSessionId);
        if (state?.sessionId) {
          noteLastSsSession(payload.profileId, payload.cwd, state.sessionId);
          noteSsRpcSession(state.sessionId);
        }
      })
      .catch((e: unknown) => {
        /* 启动失败:先收割残留再进 error 态;秒退时 stderr 尾行(真因)优先。 */
        session.kill();
        if (sessionRef.current !== session) return;
        /* omp 零消息 RPC 会话不落盘(get_state 已回 sid 但 jsonl 未建,实证):resume 目标 Session not found → 降级新建重启一次,不卡 error 态。 */
        if (!dropResumeRef.current && !!payload.resumeSessionId && /not found/i.test(stderrTailRef.current ?? "")) {
          dropResumeRef.current = true;
          startedRef.current = false;
          startSession();
          return;
        }
        sessionRef.current = null;
        setStatusText(stderrTailRef.current ?? errTextDisplay(e));
        setPhase("error");
      });
  };
  const retry = () => {
    flushBlocks();
    const canResume = !!sessionId && !!host.getCliProfile(payload.profileId)?.structuredRpc?.resumeArgs;
    resumeRef.current = canResume ? sessionId : null;
    /* retry 种子剪尾旗:末轮在途 → 剪掉(resume 重放整轮);已结算 → 全量保末轮。 */
    seedRef.current = canResume ? [...blocks] : null; seedKeepRef.current = canResume ? !(sessionRef.current?.hasOpenTurn() ?? false) : true;
    sessionRef.current?.kill();
    sessionRef.current = null;
    evidence.reset(canResume ? sessionId : undefined);
    turnLive.reset();
    startedRef.current = false;
    if (!canResume) {
      setBlocks([]);
      setTurnStart(0);
    }
    setQueued(0); setConfirm(null); setBusy(false);
    startSession();
  };
  useEffect(() => {
    startSession();
    return () => {
      startedRef.current = false;
      clearTimeout(flushTimerRef.current ?? undefined);
      /* 收养流:延迟一拍 kill 给 StrictMode 第二遍挂载接管窗口(评审 P2);闭包捕获 session 本体 —— ref 已置 null,惰性读会杀不到。 */
      if (payload.adoptStreamId && sessionRef.current) {
        const adopted = sessionRef.current;
        scheduleAdoptKill(payload.adoptStreamId, () => adopted.kill());
      } else {
        sessionRef.current?.kill();
      }
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
      .then(() => {
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          evidence.prompt(sessionId, text, {
            engine: host.getCliProfile(payload.profileId)?.name ?? payload.profileId,
            model: model?.id ?? "",
            thinking: thinkingLevel ?? "",
          }, busy);
        }
        return s.getState();
      })
      .then((st) => setQueued(st?.queuedMessageCount ?? 0))
      .catch((e: unknown) => {
        setStatusText(errTextDisplay(e));
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
    phase, statusText, warns, blocks, turnStart, busy, busySince, elapsed, confirm,
    model, thinkingLevel, sessionId, queued, stats, draft, setDraft,
    liveSurface, turnLive: turnLive.live,
    sessionRef, stickRef, retry, send, answerConfirm, onStateRefresh, dismissWarn,
  };
}
