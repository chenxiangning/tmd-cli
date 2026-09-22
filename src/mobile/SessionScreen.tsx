/**
 * session 屏 —— 只读实况 + ask 审批卡 + composer 发送(原型 mobile-app-session.html)。
 * 实况 = pty://out 字节原样透传(剥 ANSI 展示),手机纯旁观不写 PTY;
 * ask 卡 = 活流尾窗命中标记即出现,允许/拒绝 = 与幕布按键同一 session_write;
 * composer = Enter 发送(session_write text+\r),图片/拖拽手机端禁用;
 * 键盘工具条 = v1.5 预留置灰展示。
 */
import React, { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { HostBar } from "./MobileApp";
import { useMobile } from "./shared";
import { notifyAsk } from "./shared";
import { glyphOf, onPtyOut, tailAskLine, tailHasAskMarker, writeSession } from "./remote";

const TAIL_LINES = 400;

export function SessionScreen(props: { sessionId: string }) {
  const { sessions, titleOf, go } = useMobile();
  const meta = sessions.find((s) => s.id === props.sessionId);
  const [live, setLive] = useState("");
  const [ask, setAsk] = useState(false);
  const [askQ, setAskQ] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ckpt, setCkpt] = useState<{ pending: number; approved: number } | null>(null);
  const liveRef = React.useRef<HTMLDivElement | null>(null);
  const askSeen = React.useRef(false);
  const g = glyphOf(meta?.profile_id ?? "");

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

  /* 活流订阅:字节累积进 ref/state;ask 检测在独立 effect(不在 state updater 内做副作用)。 */
  const bufRef = React.useRef("");
  useEffect(() => {
    if (!props.sessionId) return;
    let alive = true;
    let off: (() => void) | null = null;
    bufRef.current = "";
    setLive("");
    void (async () => {
      off = await onPtyOut(props.sessionId, (chunk) => {
        if (!alive) return;
        bufRef.current = (bufRef.current + chunk).split("\n").slice(-TAIL_LINES).join("\n");
        setLive(bufRef.current);
      });
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, [props.sessionId]);

  /* ask 检测:live 变化后对尾窗跑标记(命中 → 卡 + 首现通知;消失 → 自愈收卡)。 */
  useEffect(() => {
    if (!props.sessionId || !live) return;
    let alive = true;
    void tailHasAskMarker(live).then((hit) => {
      if (!alive) return;
      if (hit) {
        if (!askSeen.current) {
          askSeen.current = true;
          notifyAsk(titleOf(meta ?? ({ id: props.sessionId } as never)));
        }
        setAsk(true);
        void tailAskLine(live).then((line) => {
          if (alive && line) setAskQ(line);
        });
      } else {
        setAsk(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [live, props.sessionId, meta, titleOf]);

  /* 自动滚底(新字节到达时;用户上滚不拽)。 */
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live]);

  const answer = (data: string) => {
    setAsk(false);
    void writeSession(props.sessionId, data);
  };
  const send = () => {
    const text = draft.trimEnd();
    if (!text) return;
    setDraft("");
    void writeSession(props.sessionId, `${text}\r`);
  };


  return (
    <>
      <HostBar />
      <div className="nav">
        <button type="button" className="back" aria-label={t("返回列表")} onClick={() => go({ view: "home" })}>
          ‹
        </button>
        <span className={`glyph ${g.cls}`}>{g.text}</span>
        <span className="t">{titleOf(meta ?? ({ id: props.sessionId, profile_id: "", cwd: "" } as never))}</span>
        <span className="run">{t("运行中")}</span>
      </div>
      <div className="live" ref={liveRef}>
        {live || t("已连接,等待输出…(v1 实况为连接期活流)")}
      </div>
      {ask && (
        <div className="ask">
          <div className="ask-head">⚠ {t("审批请求")}</div>
          <div className="ask-q">{askQ ?? t("CLI 正在等待确认;「允许」发送 Enter,「拒绝」发送 Esc")}</div>
          <div className="ask-opts">
            <button type="button" className="opt yes" onClick={() => answer("\r")}>
              {t("允许")}
            </button>
            <button type="button" className="opt no" onClick={() => answer("\x1b")}>
              {t("拒绝")}
            </button>
          </div>
        </div>
      )}
      {ckpt && (
        <div className="ckpt">
          <b>{t("审批线")}</b>
          <span className="chip">{t("待审 {n}", { n: ckpt.pending })}</span>
          <span className="chip g">{t("已通过 {n}", { n: ckpt.approved })}</span>
        </div>
      )}
      <div className="composer">
        <div className="box">
          <textarea
            rows={1}
            value={draft}
            placeholder={t("输入消息,回车发送…")}
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
        <div className="tools">
          <span>{t("回车发送 · Shift+回车换行")}</span>
          <span style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>{t("图片/拖拽手机端不可用")}</span>
        </div>
      </div>
      <div className="toolbar-row">
        <span className="key">esc</span>
        <span className="key">tab</span>
        <span className="key">ctrl</span>
        <span className="key">↑</span>
        <span className="key">↓</span>
        <span className="key">/</span>
        <span style={{ marginLeft: "auto", fontSize: "9.5px", color: "var(--fg-faint)" }}>
          {t("v1.5 预留:终端键盘(现在不可用)")}
        </span>
      </div>
    </>
  );
}
