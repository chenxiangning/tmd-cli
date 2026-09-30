/**
 * session 屏 —— 单顶栏(返回/标题/横屏/审批芯片/主机芯片)+ 实况 + ask 卡 + composer。
 * 实况 = LiveScreen 迷你 VT 屏;ask 卡/键盘工具条 = 同一 session_write 通道;
 * 审批线 = nav 芯片 + 只读 sheet(checkpoint_list/batch_diff 白名单二令);
 * composer Enter 发送;软键盘弹起时键条隐藏(spec 2026-09-23-mobile-session-compact)。
 * 选图经 useShots 预览挂载,发送时统一拼 @路径(草稿只留文字;2026-09-30)。
 * composer 顶部把手上下拉调输入框高(useComposerSize,落手记忆;2026-09-30)。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { useLiveStream } from "./useLiveStream";
import { useCkptBadge, useLiveTurns, useTerminalFit } from "./sessionHooks";
import { ConnBanner } from "./ConnChip";
import { HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { notifyAsk } from "./shared";
import { composeSendText, tailAskLine, tailHasAskMarker, writeSession } from "./remote";
import { useShots } from "./useShots";
import { useComposerSize } from "./useComposerSize";
import { shellInvoke } from "@kernel/shellBridge";
import { EngineMark } from "./EngineMark";
import { AskCard, LiveBlock, TurnsView } from "./TurnsView";
import { KeyToolbar } from "./KeyToolbar";
import { CkptSheet } from "./CkptSheet";

/* 实况 = LiveScreen 迷你 VT 屏模型渲染(见 ./liveText)。 */

/** 截图钮三态文案(独立小函数:嵌套三元留在 React 函数体会推高复杂度闸)。 */
function shotLabel(busy: boolean, err: boolean): string {
  if (busy) return "…";
  return err ? "✕" : "图";
}
/* 移动端单屏组件:ask/截图/检查点/发送四态分支密度是本质复杂度,拆子组件需跨层透传 8+ 个状态 setter,弊大于利。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function SessionScreen(props: { sessionId: string; spawnedAt?: number }) {
  const { sessions, titleOf, go } = useMobile();
  const meta = sessions.find((s) => s.id === props.sessionId);
  const [ask, setAsk] = useState(false);
  const [askQ, setAskQ] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ckptSheet, setCkptSheet] = useState(false);
  const { shots, onShot, removeShot, clearShots, busy: shotBusy, err: shotErr } = useShots();

  /* 输入框高度:紧凑态随内容长高(2 行起步,封顶 6 行内滚),拖拽固定高直接钉 px;CSS min/max 兜底。 */
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const { taH, grabHandlers } = useComposerSize(taRef);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (taH !== null) {
      el.style.height = `${taH}px`;
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft, taH]);
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

  /* transcript(spec 2026-09-25-mobile-session-render):jsonl 定位 + 2s 增量生长;
   * 失败/非契约引擎回落 null → PTY 尾流实况。 */
  const turns = useLiveTurns(meta?.profileId, meta?.cwd, props.sessionId, props.spawnedAt);
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

  const { live, earlier, hasMore, loadingEarlier, loadEarlier } = useLiveStream(props.sessionId);

  useTerminalFit(props.sessionId, liveRef, liveShown);
  /* 加载更早:前置渲染不改 scrollTop,视口自然留在当前行;期间暂停跟随防跳底。 */
  const loadEarlierKeepScroll = () => {
    followRef.current = false;
    loadEarlier();
  };

  /* ask 检测:live 变化后对尾窗跑标记(命中 → 卡 + 首现通知;消失 → 自愈收卡);截尾 8K(标记只在末屏,全量 stripAnsi 是每帧全文扫)。 */
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
  const [sendErr, setSendErr] = useState(false);
  const send = () => {
    const msg = composeSendText(draft, shots.map((s) => s.path));
    if (msg === null) return;
    /* 桌面契约 = 写入失败保草稿:成功才清草稿/挂图并清错,失败保留输入给可见错误。 */
    writeSession(props.sessionId, `${msg}\r`)
      .then(() => {
        setDraft("");
        clearShots();
        setSendErr(false);
      })
      .catch(() => setSendErr(true));
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
      <div className={"composer" + (kbOn && !kbOpen ? " kb-on" : "") + (taH !== null ? " grow" : "")}>
        <div className="grabber" {...grabHandlers} />
        <ShotStrip shots={shots} onRemove={removeShot} />
        <div className="box">
          <button type="button" className={"kb-toggle" + (kbOn ? " on" : "")} aria-label={t("键盘工具条")} onClick={toggleKb}>⌨</button>
          <button type="button" className="kb-toggle" aria-label={t("注入截图")} disabled={shotBusy} onClick={onShot}>
            {shotLabel(shotBusy, shotErr)}
          </button>
          <textarea
            ref={taRef}
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
          <button type="button" className="send" aria-label={t("发送")} onClick={send}>
            ↑
          </button>
        </div>
        {sendErr && <div className="m-err">{t("发送失败,消息已保留,请重试")}</div>}
      </div>
      <KeyToolbar sessionId={props.sessionId} hidden={kbOpen || !kbOn} />
      {ckptSheet && meta?.cwd && (
        <CkptSheet cwd={meta.cwd} sessionId={props.sessionId} onClose={() => setCkptSheet(false)} />
      )}
    </>
  );
}


/** 选图预览缩略图行(空态返 null;移除按 path 定位,objectURL 释放归 useShots)。 */
function ShotStrip(props: { shots: { path: string; url: string }[]; onRemove: (path: string) => void }) {
  if (!props.shots.length) return null;
  return (
    <div className="shots">
      {props.shots.map((s) => (
        <div className="shot" key={s.path}>
          <img src={s.url} alt="" />
          <button type="button" className="shot-x" aria-label={t("移除图片")} onClick={() => props.onRemove(s.path)}>
            ✕
          </button>
        </div>
      ))}
    </div>
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
