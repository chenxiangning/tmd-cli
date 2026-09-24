/**
 * session 屏 —— 单顶栏(返回/标题/横屏/审批芯片/主机芯片)+ 实况 + ask 卡 + composer。
 * 实况 = LiveScreen 迷你 VT 屏;ask 卡/键盘工具条 = 同一 session_write 通道;
 * 审批线 = nav 芯片 + 只读 sheet(checkpoint_list/batch_diff 白名单二令);
 * composer Enter 发送;软键盘弹起时键条隐藏(spec 2026-09-23-mobile-session-compact)。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { useLiveStream } from "./useLiveStream";
import { useCkptBadge, useTerminalFit } from "./sessionHooks";
import { ConnBanner } from "./ConnChip";
import { HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { notifyAsk } from "./shared";
import { tailAskLine, tailHasAskMarker, writeSession } from "./remote";
import { shellInvoke } from "@kernel/shellBridge";
import { loadTranscript } from "./sessionFile";
import { EngineMark } from "./EngineMark";
import { AskCard, LiveBlock, TurnsView } from "./TurnsView";
import { type TranscriptTurn } from "@kernel/transcript";
import { KeyToolbar } from "./KeyToolbar";
import { CkptSheet } from "./CkptSheet";

/* 实况 = LiveScreen 迷你 VT 屏模型渲染(见 ./liveText)。 */

export function SessionScreen(props: { sessionId: string }) {
  const { sessions, titleOf, go } = useMobile();
  const meta = sessions.find((s) => s.id === props.sessionId);
  const [ask, setAsk] = useState(false);
  const [askQ, setAskQ] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ckptSheet, setCkptSheet] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  /* 键盘工具条折叠(pref 持久化); composers 行 ⌨ 切换。 */
  const [kbOn, setKbOn] = useState(() => {
    try {
      return localStorage.getItem("tmd.keybar.on") !== "0";
    } catch {
      return true;
    }
  });
  const toggleKb = () => {
    const n = !kbOn;
    setKbOn(n);
    try {
      localStorage.setItem("tmd.keybar.on", n ? "1" : "0");
    } catch { /* 隐私态 */ }
  };
  const liveRef = React.useRef<HTMLDivElement | null>(null);
  const askSeen = React.useRef(false);
  
  const ckpt = useCkptBadge(meta?.cwd, props.sessionId);

  /* transcript(单独解析):CLI 磁盘 jsonl → 对话/操作分层渲染;失败回落 PTY 尾流。 */
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  /* 实况块:有对话时默认折叠(终端原始流在窄屏不可读),点开看;无对话=全屏实况。 */
  const [liveOpen, setLiveOpen] = useState(false);
  const liveShown = turns ? liveOpen : true;
  /* 横竖屏切换:壳内走原生 requestGeometryUpdate;无壳(浏览器目检)CSS 旋转兜底。 */
  const [landscape, setLandscape] = useState(false);
  const toggleOrient = () => {
    const next = !landscape;
    setLandscape(next);
    void shellInvoke("screen.orient", { mode: next ? "landscape" : "portrait" }).catch(() => {
      document.querySelector(".m-app")?.classList.toggle("m-land", next);
    });
  };
  useEffect(
    () => () => {
      /* 离开会话屏恢复竖屏(无论当前朝向,统一归位) */
      void shellInvoke("screen.orient", { mode: "portrait" }).catch(() => {
        document.querySelector(".m-app")?.classList.remove("m-land");
      });
    },
    [],
  );
  useEffect(() => {
    const profile = meta?.profileId;
    const cwd = meta?.cwd;
    if (!profile || !cwd) return;
    let alive = true;
    setTurns(null);
    void loadTranscript(profile, cwd).then((t) => {
      if (alive) setTurns(t);
    });
    return () => {
      alive = false;
    };
  }, [meta?.profileId, meta?.cwd, props.sessionId]);

  const { live, earlier, hasMore, loadingEarlier, loadEarlier } = useLiveStream(props.sessionId);

  useTerminalFit(props.sessionId, liveRef, liveShown);
  /* 加载更早:前置渲染不改 scrollTop,视口自然留在当前行;期间暂停跟随防跳底。 */
  const loadEarlierKeepScroll = () => {
    followRef.current = false;
    loadEarlier();
  };

  /* ask 检测:live 变化后对尾窗跑标记(命中 → 卡 + 首现通知;消失 → 自愈收卡)。
     截尾 8K:标记只在末屏,全量 stripAnsi 在 2000 行 scrollback 下是每帧全文扫。 */
  const metaId = meta?.profileId ?? "";
  const metaCwd = meta?.cwd ?? "";
  useEffect(() => {
    if (!props.sessionId || !live) return;
    let alive = true;
    void tailHasAskMarker(live.slice(-8192)).then((hit) => {
      if (!alive) return;
      if (hit) {
        if (!askSeen.current) {
          askSeen.current = true;
          notifyAsk(titleOf(meta ?? ({ id: props.sessionId, profileId: "", cwd: "" } as never)));
        }
        setAsk(true);
        void tailAskLine(live.slice(-8192)).then((line) => {
          if (alive && line) setAskQ(line);
        });
      } else {
        setAsk(false);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meta 派生串入依赖,免 2.5s 轮询新引用带崩
  }, [live, props.sessionId, metaId, metaCwd, titleOf]);
  /* 自动滚底 = 跟随态(贴底 <48px)时新输出拽底;上滚阅读历史不被打断。
   * 展开实况块 = 重进跟随并跳底(看最新是默认预期)。实况折叠时不滚。 */
  const followRef = React.useRef(true);
  useEffect(() => {
    const el = liveRef.current;
    if (!el) return;
    const onScroll = () => {
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!liveShown) return;
    const el = liveRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [live, liveShown]);
  useEffect(() => {
    if (!liveShown) return;
    followRef.current = true;
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveShown]);

  const answer = (data: string) => {
    setAsk(false);
    /* 写失败(断桥/死会话)回滚弹卡:否则卡瞬时消失且无后续输出复现(契约评审 face4)。 */
    writeSession(props.sessionId, data).catch(() => setAsk(true));
  };
  const send = () => {
    const text = draft.trimEnd();
    if (!text) return;
    setDraft("");
    void writeSession(props.sessionId, `${text}\r`);
  };

  return (
    <>
      <SessionHeader
        title={titleOf(meta ?? ({ id: props.sessionId, profileId: "", cwd: "" } as never))}
        profileId={meta?.profileId ?? ""}
        ckpt={ckpt}
        landscape={landscape}
        onBack={() => go({ view: "home" })}
        onCkpt={() => setCkptSheet(true)}
        onOrient={toggleOrient}
      />
      <ConnBanner />
      <div className="live" ref={liveRef}>
        {turns && <TurnsView turns={turns} />}
        <LiveBlock
          turns={turns}
          live={live}
          liveShown={liveShown}
          onExpandLive={() => setLiveOpen(true)}
          onCollapseLive={() => setLiveOpen(false)}
          earlier={earlier}
          hasMore={hasMore}
          loadingEarlier={loadingEarlier}
          onLoadEarlier={loadEarlierKeepScroll}
        />
      </div>
      {ask && <AskCard q={askQ} onAnswer={answer} />}
      <div className={"composer" + (kbOn && !kbOpen ? " kb-on" : "")}>
        <div className="box">
          <button type="button" className={"kb-toggle" + (kbOn ? " on" : "")} aria-label={t("键盘工具条")} onClick={toggleKb}>⌨</button>
          <textarea
            rows={1}
            value={draft}
            placeholder={t("输入消息,回车发送…")}
            onFocus={() => setKbOpen(true)}
            onBlur={() => setKbOpen(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="send" aria-label={t("发送")} disabled={!draft.trim()} onClick={send}>
            ↑
          </button>
        </div>
      </div>
      <KeyToolbar sessionId={props.sessionId} hidden={kbOpen || !kbOn} />
      {ckptSheet && meta?.cwd && (
        <CkptSheet cwd={meta.cwd} sessionId={props.sessionId} onClose={() => setCkptSheet(false)} />
      )}
    </>
  );
}


/** 会话顶栏:返回/引擎/标题/审批线 chip/横竖屏切换/通道(纯展示,状态在父组件)。 */
function SessionHeader(props: {
  title: string;
  profileId: string;
  ckpt: { pending: number; approved: number } | null;
  landscape: boolean;
  onBack: () => void;
  onCkpt: () => void;
  onOrient: () => void;
}) {
  return (
    <div className="nav">
      <button type="button" className="back" aria-label={t("返回列表")} onClick={props.onBack}>
        ‹
      </button>
      <EngineMark profileId={props.profileId} />
      <span className="t">{props.title}</span>
      {props.ckpt && (
        <button
          type="button"
          className={`nav-chip${props.ckpt.pending > 0 ? " warn" : ""}`}
          aria-label={t("审批线")}
          onClick={props.onCkpt}
        >
          {t("审批")}
          {props.ckpt.pending > 0 ? ` ${props.ckpt.pending}` : ""}
        </button>
      )}
      <button type="button" className="orient-btn" aria-label={t("切换横竖屏")} onClick={props.onOrient}>
        {props.landscape ? t("竖屏") : t("横屏")}
      </button>
      <HostChip />
    </div>
  );
}
