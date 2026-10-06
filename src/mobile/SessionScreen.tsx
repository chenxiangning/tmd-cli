/**
 * session 屏 —— 单顶栏(返回/标题/横屏/审批芯片/主机芯片)+ 实况 + ask 卡 + composer。
 * 实况 = LiveScreen 迷你 VT 屏;ask 卡/键盘工具条 = 同一 session_write 通道;
 * 审批线 = nav 芯片 + 只读 sheet(checkpoint_list/batch_diff 白名单二令);
 * composer 裸 Enter=换行(软键盘无 Shift;发送归 ↑ 钮,⌘/Ctrl+Enter 兜底);
 * 软键盘弹起时键条隐藏(spec 2026-09-23-mobile-session-compact)。
 * 选图经 useShots 预览挂载,发送时统一拼 @路径(草稿只留文字;2026-09-30)。
 * composer 三态胶囊重做迁 Composer.tsx(spec 2026-10-03-mobile-composer-redesign;
 * 拖拽调高把手随迁移回 Composer,本屏只持草稿/挂图/发送状态)。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { useLiveStream, useSessionExit } from "./useLiveStream";
import { useCkptBadge, useLiveTurns, useTerminalFit } from "./sessionHooks";

import { isTailTruncated, MAX_TURNS } from "./sessionFile";
import { ConnBanner } from "./ConnChip";
import { askEdgeNotify, askRoundClear, notifyExit, useMobile } from "./shared";
import { composeSendText, resumeExitedSession, tailAskLine, tailHasAskMarker, writeSession } from "./remote";
import { canSend } from "./sendGate";
import { useShots } from "./useShots";
import { useDraft } from "./useDraft";
import { shellInvoke } from "@kernel/shellBridge";
import { engineWire } from "./engines";
import { AskCard, LiveBlock, TurnsView } from "./TurnsView";
import { CkptSheet } from "./CkptSheet";
import { TimelineSheet } from "./timelineSheet";
import { timelineSupported, type TimelineEntry } from "./timelineData";
import { TimelineHistory } from "./timelineHistory";
import { SessionHeader, ShotPreview } from "./SessionChrome";
import { Composer } from "./Composer";
import { StatusBar } from "./StatusBar";

/* 实况 = LiveScreen 迷你 VT 屏模型渲染(见 ./liveText)。 */

/* 移动端单屏组件:ask/检查点/发送分支密度是本质复杂度,拆子组件需跨层透传
 * 8+ 个状态 setter,弊大于利(先例注释,豁免同前)。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function SessionScreen(props: { sessionId: string; spawnedAt?: number }) {
  const { sessions, titleOf, go } = useMobile();
  const meta = sessions.find((s) => s.id === props.sessionId);
  const [ask, setAsk] = useState(false);
  const [askQ, setAskQ] = useState<string | null>(null);
  /* 草稿持久化(useDraft):返回 home 卸载不丢未发文字;发送成功清除。 */
  const { draft, setDraft, clear: clearDraft } = useDraft(props.sessionId);
  const [ckptSheet, setCkptSheet] = useState(false);
  const [tlSheet, setTlSheet] = useState(false);
  const { shots, pending, onShot, onPhoto, removeShot, clearShots, busy: shotBusy, err: shotErr } = useShots();
  /* 挂图全屏预览(缩略图点开看大图,点击关闭)。 */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const liveRef = React.useRef<HTMLDivElement | null>(null);
  /* 终局快照(退出后续聊/通知用退出前元数据):写入收进 effect 保 render 纯性。 */
  const metaRef = React.useRef<typeof meta>(undefined);
  useEffect(() => { if (meta) metaRef.current = meta; });
  /* 草稿镜像(send 成功回调比对「是否续打」用,同 metaRef 模式):发送在途
   * 继续输入的文字不随成功清稿 —— 只清「与发送时一致」的草稿。 */
  const draftRef = React.useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  
  const ckpt = useCkptBadge(meta?.cwd, props.sessionId);
  /* 时间线跳转(2026-10-05 二轮):任意条目(offset 锚)→ 历史定位视图
   * (前后文快照互斥替代尾窗,组件 timelineHistory);桌面 jumpToAnchor 的
   * 「不在 buffer 逐页加载」在手机 = offset 精确分段读。 */
  const [hist, setHist] = useState<{ path: string; entry: TimelineEntry } | null>(null);
  const jumpToTimeline = (path: string, entry: TimelineEntry) => {
    setTlSheet(false);
    setHist({ path, entry });
  };

  /* transcript(spec 2026-09-25-mobile-session-render):jsonl 定位 + 2s 增量生长;
   * 失败/非契约引擎回落 null → PTY 尾流实况。poke = 写入成功后 300ms 补拍
   * (spec 2026-10-03):发消息/应答 ~0.3s 上屏,不白等 2s 拍。 */
  const { turns, poke } = useLiveTurns(meta?.profileId, meta?.cwd, props.sessionId, props.spawnedAt, meta?.cliSessionId);
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
      .then(() => poke())
      .catch(() => setAsk(true))
      .finally(() => setAnswering(false));
  };
  const [sendErr, setSendErr] = useState(false);
  const [sending, setSending] = useState(false);
  const send = () => {
    /* 在途闸(纯函数 canSend 钉死,测试钉真值表):发送中/图片上传中(pending/
     * 选图中)一律不发 —— 发送钮禁用只是 UI 闸,错误条「重试」钮与 ⌘/Ctrl+
     * Enter 键路不经按钮,须在本体收口(2026-10-03 评审:否则文字先发、在途
     * 图片 clearShots 后落单「复活」)。 */
    if (!canSend(sending, pending != null, shotBusy)) return;
    /* 发送起点快照:成功后只清这些 —— sending 在途新挂的图不在本次消息里,
     * 全清会把它静默丢掉(2026-10-03 二轮评审:远程桥 RTT 秒级,窗口真实)。
     * 草稿同理:在途续打的文字不随成功清稿,只清「与发送时一致」的草稿。 */
    const sentPaths = shots.map((s) => s.path);
    const sentDraft = draft;
    const msg = composeSendText(draft, sentPaths);
    if (msg === null) {
      setSendErr(false); /* 内容已清空:错误条失去重试对象,退场免死钮(2026-10-04 复审) */
      return;
    }
    /* 桌面契约 = 写入失败保草稿:成功才清草稿/挂图并清错。 */
    setSending(true);
    writeSession(props.sessionId, engineWire(meta?.profileId ?? "", msg))
      .then(() => {
        if (draftRef.current === sentDraft) clearDraft();
        clearShots(sentPaths);
        setSendErr(false);
        poke();
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
        {hist ? (
          <TimelineHistory path={hist.path} entry={hist.entry} liveRef={liveRef} onBack={() => setHist(null)} />
        ) : (
          <>
            {turns && <TurnsView turns={turns} />}
            {turns && isTailTruncated(turns) && (
              <div className="list-note">{t("已显示最近 {n} 轮,完整历史点时间线", { n: MAX_TURNS })}</div>
            )}
          </>
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
      {meta && (
        <StatusBar sessionId={props.sessionId} profileId={meta.profileId} cwd={meta.cwd}
          cliSessionId={meta.cliSessionId} turnActive={meta.activity?.turnActive} />
      )}
      <Composer
        sessionId={props.sessionId}
        draft={draft}
        onDraft={(v) => {
          setDraft(v);
          /* 桌面契约:发送失败后继续输入即清错(重试钮仍在,双保险)。 */
          if (sendErr) setSendErr(false);
        }}
        onSend={send}
        sending={sending}
        sendErr={sendErr}
        shotErr={shotErr}
        onRetry={send}
        shots={shots}
        pending={pending}
        shotBusy={shotBusy}
        onShot={onShot}
        onPhoto={onPhoto}
        onRemoveShot={removeShot}
        onPreview={setPreviewUrl}
        ckptReady={!!meta?.cwd}
        timelineReady={!!meta?.cwd && timelineSupported(meta.profileId)}
        onTimeline={() => setTlSheet(true)}
        onCkpt={() => setCkptSheet(true)}
      />
      <ShotPreview url={previewUrl} onClose={() => setPreviewUrl(null)} />
      {ckptSheet && meta?.cwd && (
        <CkptSheet cwd={meta.cwd} sessionId={props.sessionId} onClose={() => setCkptSheet(false)} />
      )}
      {tlSheet && meta?.cwd && meta.profileId && (
        <TimelineSheet
          profileId={meta.profileId}
          cwd={meta.cwd}
          cliSessionId={meta.cliSessionId}
          onClose={() => setTlSheet(false)}
          onJump={jumpToTimeline}
        />
      )}
    </>
  );
}
