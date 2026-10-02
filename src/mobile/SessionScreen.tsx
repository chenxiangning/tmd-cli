/**
 * session 屏 —— 单顶栏(返回/标题/横屏/审批芯片/主机芯片)+ 实况 + ask 卡 + composer。
 * 实况 = LiveScreen 迷你 VT 屏;ask 卡/键盘工具条 = 同一 session_write 通道;
 * 审批线 = nav 芯片 + 只读 sheet(checkpoint_list/batch_diff 白名单二令);
 * composer 裸 Enter=换行(软键盘无 Shift;发送归 ↑ 钮,⌘/Ctrl+Enter 兜底);
 * 软键盘弹起时键条隐藏(spec 2026-09-23-mobile-session-compact)。
 * 选图经 useShots 预览挂载,发送时统一拼 @路径(草稿只留文字;2026-09-30)。
 * composer 顶部把手上下拉调输入框高(useComposerSize,落手记忆;2026-09-30)。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { useLiveStream, useSessionExit } from "./useLiveStream";
import { useCkptBadge, useLiveTurns, useTerminalFit } from "./sessionHooks";
import { isTailTruncated, MAX_TURNS } from "./sessionFile";
import { ConnBanner } from "./ConnChip";
import { askEdgeNotify, askRoundClear, notifyExit, useMobile } from "./shared";
import { composeSendText, resumeExitedSession, tailAskLine, tailHasAskMarker, writeSession } from "./remote";
import { useShots } from "./useShots";
import { useComposerSize } from "./useComposerSize";
import { useDraft } from "./useDraft";
import { mobileEnterAction } from "./enterSend";
import { shellInvoke } from "@kernel/shellBridge";
import { AskCard, LiveBlock, TurnsView } from "./TurnsView";
import { KeyToolbar } from "./KeyToolbar";
import { CkptSheet } from "./CkptSheet";
import { SessionHeader, ShotStrip, SendErrBars, ShotPreview } from "./SessionChrome";

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
  /* 草稿持久化(useDraft):返回 home 卸载不丢未发文字;发送成功清除。 */
  const { draft, setDraft, clear: clearDraft } = useDraft(props.sessionId);
  const [ckptSheet, setCkptSheet] = useState(false);
  const { shots, onShot, removeShot, clearShots, busy: shotBusy, err: shotErr } = useShots();
  /* 挂图全屏预览(缩略图点开看大图,点击关闭)。 */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* 输入框高度:紧凑态随内容长高(2 行起步,封顶 6 行内滚),拖拽固定高直接钉 px;CSS min/max 兜底。 */
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const { taH, dragging, grabHandlers } = useComposerSize(taRef);
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
  /* 终局快照(退出后续聊/通知用退出前元数据):写入收进 effect 保 render 纯性。 */
  const metaRef = React.useRef<typeof meta>(undefined);
  useEffect(() => { if (meta) metaRef.current = meta; });
  
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

  /* ask 检测:live 变化后对尾窗跑标记(命中 → 卡 + 首现通知;消失 → 自愈收卡);截尾 8K(标记只在末屏,全量 stripAnsi 是每帧全文扫)。
   * 通知走 shared 边沿台账:home 轮询与实况检测同一本账,同一轮只报一次。 */
  useEffect(() => {
    if (!props.sessionId || !live) return;
    let alive = true;
    void tailHasAskMarker(live.slice(-8192)).then((hit) => {
      if (!alive) return;
      askEdgeNotify(props.sessionId, hit, titleOf(meta ?? ({ id: props.sessionId, profileId: "", cwd: "" } as never)));
      if (!hit) {
        setAsk(false);
        return;
      }
      setAsk(true);
      void tailAskLine(live.slice(-8192)).then((line) => {
        if (alive && line) setAskQ(line);
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meta 派生串入依赖,免 2.5s 轮询新引用带崩
  }, [live, props.sessionId, meta?.profileId, meta?.cwd, titleOf]);

  /* 会话终局(pty://exit 事件或列表消失兜底):横幅 + 本地通知(与 ask 同通道)
   * + 续聊钮(resume.ts 链:磁盘身份直注 spawn 冷开/日志指针聚焦)。 */
  const [exited, setExited] = useState(false);
  const [resuming, setResuming] = useState(false);
  useSessionExit(props.sessionId, sessions, () => {
    setExited(true);
    askRoundClear(props.sessionId);
    notifyExit(titleOf(metaRef.current ?? ({ id: props.sessionId, profileId: "", cwd: "" } as never)));
  });
  const resumeChat = () => {
    const m = metaRef.current;
    if (resuming || !m?.cliSessionId) return;
    setResuming(true);
    void resumeExitedSession(m, sessions)
      .then((id) => { if (id) go({ view: "session", sessionId: id }); })
      .catch(() => undefined).finally(() => setResuming(false));
  };
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
    if (answering) return; /* 在途闸:外网 RTT 下双击不双写 */
    setAnswering(true);
    setAsk(false);
    /* 写失败(断桥/死会话)回滚弹卡:否则卡瞬时消失且无后续输出复现(契约评审 face4)。 */
    writeSession(props.sessionId, data)
      .catch(() => setAsk(true))
      .finally(() => setAnswering(false));
  };
  const [sendErr, setSendErr] = useState(false);
  const [sending, setSending] = useState(false);
  const send = () => {
    if (sending) return; /* 在途闸:双击不双发 */
    const msg = composeSendText(draft, shots.map((s) => s.path));
    if (msg === null) return;
    /* 桌面契约 = 写入失败保草稿:成功才清草稿/挂图并清错,失败保留输入给可见错误条。 */
    setSending(true);
    writeSession(props.sessionId, `${msg}\r`)
      .then(() => {
        clearDraft();
        clearShots();
        setSendErr(false);
      })
      .catch(() => setSendErr(true))
      .finally(() => setSending(false));
  };
  const [answering, setAnswering] = useState(false);

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
        {turns && isTailTruncated(turns) && (
          <div className="list-note">{t("已显示最近 {n} 轮,更早内容在桌面客户端查看", { n: MAX_TURNS })}</div>
        )}
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
      {exited && (
        <div className="list-note">
          <div>{t("会话已退出")}</div>
          {metaRef.current?.cliSessionId && (
            <button type="button" className="more" onClick={resumeChat} disabled={resuming}>{resuming ? "…" : t("继续对话")}</button>
          )}
        </div>
      )}
      {ask && !exited && <AskCard q={askQ} onAnswer={answer} busy={answering} />}
      <div className={"composer" + (kbOn && !kbOpen ? " kb-on" : "") + (taH !== null ? " grow" : "")}>
        <SendErrBars sendErr={sendErr} shotErr={shotErr} onRetry={send} />
        <div className={"grabber" + (dragging ? " drag" : "")} {...grabHandlers} />
        <ShotStrip shots={shots} onRemove={removeShot} onPreview={setPreviewUrl} />
        <div className="box">
          <button type="button" className={"kb-toggle" + (kbOn ? " on" : "")} aria-label={t("键盘工具条")} onClick={toggleKb}>⌨</button>
          <button type="button" className="kb-toggle" aria-label={t("注入截图")} disabled={shotBusy} onClick={onShot}>
            {shotLabel(shotBusy, shotErr)}
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder={t("输入消息…")}
            onFocus={() => setKbOpen(true)}
            onBlur={() => setKbOpen(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              /* 桌面契约:发送失败后继续输入即清错(重试钮仍在,双保险)。 */
              if (sendErr) setSendErr(false);
            }}
            onKeyDown={(e) => {
              /* 裸 Enter=换行(平台惯例),发送归 ↑ 钮与 ⌘/Ctrl+Enter;IME 组合期
               * 一律不拦截(mobileEnterAction,守卫契约同桌面 enterAction)。 */
              if (e.key !== "Enter") return;
              if (mobileEnterAction({
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                isComposing: e.nativeEvent.isComposing,
                keyCode: e.keyCode,
              }) === "send") {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="send" aria-label={t("发送")} disabled={sending} onClick={send}>
            {sending ? "…" : "↑"}
          </button>
        </div>
      </div>
      <KeyToolbar sessionId={props.sessionId} hidden={kbOpen || !kbOn} />
      <ShotPreview url={previewUrl} onClose={() => setPreviewUrl(null)} />
      {ckptSheet && meta?.cwd && (
        <CkptSheet cwd={meta.cwd} sessionId={props.sessionId} onClose={() => setCkptSheet(false)} />
      )}
    </>
  );
}

