/**
 * session 屏 —— 单顶栏(返回/标题/横屏/审批芯片/主机芯片)+ 实况 + ask 卡 + composer。
 * 实况 = LiveScreen 迷你 VT 屏;ask 卡/键盘工具条 = 同一 session_write 通道;
 * 审批线 = nav 芯片 + 只读 sheet(checkpoint_list/batch_diff 白名单二令);
 * composer Enter 发送;软键盘弹起时键条隐藏(spec 2026-09-23-mobile-session-compact)。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { ConnBanner } from "./ConnChip";
import { HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { notifyAsk } from "./shared";
import { onPtyOut, tailAskLine, tailHasAskMarker, writeSession } from "./remote";
import { shellInvoke } from "@kernel/shellBridge";
import { loadTranscript } from "./sessionFile";
import { EngineMark } from "./EngineMark";
import { AskCard, LiveBlock, TurnsView } from "./TurnsView";
import { type TranscriptTurn } from "@kernel/transcript";
import { LiveScreen } from "./liveText";
import { KeyToolbar } from "./KeyToolbar";
import { CkptSheet } from "./CkptSheet";

/* 实况 = LiveScreen 迷你 VT 屏模型渲染(见 ./liveText)。 */

export function SessionScreen(props: { sessionId: string }) {
  const { sessions, titleOf, go } = useMobile();
  const meta = sessions.find((s) => s.id === props.sessionId);
  const [live, setLive] = useState("");
  const [ask, setAsk] = useState(false);
  const [askQ, setAskQ] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ckpt, setCkpt] = useState<{ pending: number; approved: number } | null>(null);
  const [ckptSheet, setCkptSheet] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const liveRef = React.useRef<HTMLDivElement | null>(null);
  const askSeen = React.useRef(false);
  
  /* 审批线 chip:checkpoint_list(白名单只读)60s 轻拉;仅 (cwd,sessionId) 齐备时。 */
  useEffect(() => {
    const cwd = meta?.cwd;
    const cliId = props.sessionId;
    if (!cwd || !cliId) return;
    const pull = () => {
      void import("@kernel/transport").then(({ invoke }) =>
        invoke<{ id: string; open: boolean; state: string }[]>("checkpoint_list", {
          cwd,
          sessionId: cliId,
          tmdSessionId: cliId,
        })
          .then((batches) => {
            const sealed = batches.filter((b) => !b.open);
            setCkpt({
              pending: sealed.filter((b) => b.state === "pending").length,
              approved: sealed.filter((b) => b.state === "approved").length,
            });
          })
          .catch(() => setCkpt(null)),
      );
    };
    pull();
    const timer = setInterval(pull, 60_000);
    return () => clearInterval(timer);
  }, [meta?.cwd, props.sessionId]);

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

  /* 活流订阅:PTY 字节喂进迷你 VT 视口模型(LiveScreen,固定 H×W + 触底上滚),
   * 绝对定位重绘(页脚/spinner)天然收敛为一份;ask 检测在独立 effect。
   * 打开会话先拉真实 PTY 尺寸(session_size)+ 字节日志尾回放,
   * 否则老会话只有「连接期活流」——空闲老会话永远空屏。
   * 尺寸漂移再同步(2026-09-24 真机双页脚实证):PTY 尺寸归桌面 xterm 独占
   * (手机从不 resize),桌面拖面板 → omp 按新几何重绘,旧模型 CUP 钳位错位 →
   * 页脚残留两份。每 3s 校 session_size:变了即按新几何重建 + 重放日志尾。 */
  useEffect(() => {
    if (!props.sessionId) return;
    let alive = true;
    let off: (() => void) | null = null;
    let timer = 0;
    setLive("");
    void (async () => {
      const { invoke } = await import("@kernel/transport");
      const sizeOf = () =>
        invoke<[number, number] | null>("session_size", { id: props.sessionId }).catch(() => null);
      const pageOf = () =>
        invoke<{ text: string }>("session_history_page", {
          id: props.sessionId,
          before: Number.MAX_SAFE_INTEGER,
          maxBytes: 32_000,
        }).catch(() => null);
      const size = await sizeOf();
      if (!alive) return;
      let sizeKey = size ? `${size[0]}x${size[1]}` : "";
      let screen = new LiveScreen(size?.[0], size?.[1]);
      const page = await pageOf();
      if (!alive) return;
      if (page?.text) {
        screen.feed(page.text);
        setLive(screen.view());
      }
      /* rAF 合帧:每 chunk 全量 view() 重建(2000 行 scrollback join)在流式输出下
         是每帧 O(全屏) 复制;脏标 + 帧对齐把重绘压到 ≤60Hz(评审 P1-3)。 */
      let dirty = false;
      off = await onPtyOut(props.sessionId, (chunk) => {
        if (!alive) return;
        screen.feed(chunk);
        if (dirty) return;
        dirty = true;
        requestAnimationFrame(() => {
          dirty = false;
          if (alive) setLive(screen.view());
        });
      });
      timer = window.setInterval(() => {
        void (async () => {
          const s = await sizeOf();
          if (!alive || !s) return;
          const key = `${s[0]}x${s[1]}`;
          if (key === sizeKey) return;
          sizeKey = key;
          screen = new LiveScreen(s[0], s[1]);
          const p = await pageOf();
          if (!alive) return;
          if (p?.text) screen.feed(p.text);
          setLive(screen.view());
        })();
      }, 3000);
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      off?.();
    };
  }, [props.sessionId]);

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
      <div className="nav">
        <button type="button" className="back" aria-label={t("返回列表")} onClick={() => go({ view: "home" })}>
          ‹
        </button>
        <EngineMark profileId={meta?.profileId ?? ""} />
        <span className="t">{titleOf(meta ?? ({ id: props.sessionId, profileId: "", cwd: "" } as never))}</span>
        {ckpt && (
          <button
            type="button"
            className={`nav-chip${ckpt.pending > 0 ? " warn" : ""}`}
            aria-label={t("审批线")}
            onClick={() => setCkptSheet(true)}
          >
            {t("审批")}
            {ckpt.pending > 0 ? ` ${ckpt.pending}` : ""}
          </button>
        )}
        <button type="button" className="orient-btn" aria-label={t("切换横竖屏")} onClick={toggleOrient}>
          {landscape ? t("竖屏") : t("横屏")}
        </button>
        <HostChip />
      </div>
      <ConnBanner />
      <div className="live" ref={liveRef}>
        {turns && <TurnsView turns={turns} />}
        <LiveBlock
          turns={turns}
          live={live}
          liveShown={liveShown}
          onExpandLive={() => setLiveOpen(true)}
          onCollapseLive={() => setLiveOpen(false)}
        />
      </div>
      {ask && <AskCard q={askQ} onAnswer={answer} />}
      <div className="composer">
        <div className="box">
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
          <button type="button" className="send" aria-label={t("发送")} onClick={send}>
            ↑
          </button>
        </div>
      </div>
      <KeyToolbar sessionId={props.sessionId} hidden={kbOpen} />
      {ckptSheet && meta?.cwd && (
        <CkptSheet cwd={meta.cwd} sessionId={props.sessionId} onClose={() => setCkptSheet(false)} />
      )}
    </>
  );
}
