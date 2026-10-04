/**
 * 结构化会话 tab 内容 —— RPC 驱动(omp/pi `--mode rpc`),token 级流式转录 +
 * 自带输入面 + 审批回路。数据链:PiRpcSession(cli-shared)← kernel proc_stream
 * 通用原语;PTY 零涉及。渲染复用 session-viewer 的 TranscriptView(极简联动
 * 同设置);关闭 tab = kill 子进程(useEffect 收割)。生命周期编排见 ssSession.ts。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { lazy, useEffect, useMemo, useRef, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { retryImport } from "@kernel/lazyImport";
import { SsHeader } from "./ssHeader";
import { LiveTurn } from "./liveTurn";
import { ConfirmCard } from "./confirmCard";
import { TranscriptView } from "@plugins/session-viewer/transcriptView";
import { useSsSession, type Phase, type SsSessionState } from "./ssSession";
import type { PiRpcCommand, PiRpcSession } from "../cli-shared/piRpc";
import type { StructuredSessionPayload } from "./tabs";
import "./structured-session.css";

const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/* / 命令补全(目录懒载缓存 tab 生命期;↑↓ 移动,Tab/Enter 补全,Esc 关闭;
 * 仅补全不代发 —— 引擎自解析斜杠命令)。返回面接 textarea 与补全列表渲染。 */
/** useCmdComplete 返回面(Composer 消费;键盘/变更钩 + 列表渲染数据)。 */
type CmdComplete = {
  onChange: (v: string) => void;
  onKey: (e: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault(): void }) => boolean;
  matches: PiRpcCommand[];
  sel: number;
  setSel: (n: number) => void;
  complete: (c: PiRpcCommand) => void;
  open: boolean;
  cmdList: PiRpcCommand[] | null;
};
function useCmdComplete(session: PiRpcSession | null, draft: string, setDraft: (v: string) => void): CmdComplete {
  const [cmdList, setCmdList] = useState<PiRpcCommand[] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const matches = useMemo(() => {
    if (!open || !cmdList) return [];
    const q = draft.slice(1).toLowerCase();
    return cmdList.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
  }, [open, cmdList, draft]);
  const complete = (c: PiRpcCommand) => {
    setDraft(`/${c.name} `);
    setOpen(false);
  };
  /* textarea onKeyDown 前置钩;返回 true = 已消费该键。 */
  const onKey = (e: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault(): void }): boolean => {
    if (!open || matches.length === 0 || e.nativeEvent.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      complete(matches[sel]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return true;
    }
    return false;
  };
  const onChange = (v: string) => {
    setDraft(v);
    const opening = v.startsWith("/") && !v.includes(" ");
    setOpen(opening);
    setSel(0);
    if (opening && cmdList === null && session) {
      void session.getCommands().then(setCmdList).catch(() => setCmdList([]));
    }
  };
  return { onChange, onKey, matches, sel, setSel, complete, open, cmdList };
}

/* 滚动区相位横幅:启动中/启动失败/已结束(接续重开 = --resume 换壳,引擎
 * 上下文 + 转录保形;否则全复位新会话)。已结束用紧凑横幅,不占视口高空块。 */
function PhaseBanners(props: { phase: Phase; statusText: string | null; sessionId: string | null; resumable: boolean; onRetry: () => void }) {
  const { phase, statusText, resumable } = props;
  if (phase === "starting") return <div className="ss-empty">{t("启动 RPC 会话中…")}</div>;
  if (phase === "error") {
    return (
      <div className="ss-empty">
        {t("启动失败")}:{statusText}
        <button type="button" className="ss-retry" onClick={props.onRetry}>{t("重试")}</button>
      </div>
    );
  }
  if (phase === "exited") {
    return (
      <div className="ss-ended">
        {t("会话已结束(关闭此 tab 可再开)")}
        <button type="button" className="ss-retry" onClick={props.onRetry}>
          {resumable ? t("接续重开") : t("重新开启")}
        </button>
      </div>
    );
  }
  return null;
}

/* 输入面:/ 命令补全弹层 + textarea + 发送钮。confirm 在卡时 Esc 拒绝
 * (Enter 不批准 —— 打字误敲是最高频误批准源,批准经卡内按钮)。 */
function Composer(props: { ss: SsSessionState; cmd: CmdComplete }) {
  const { ss, cmd } = props;
  /* 输入框随手长高(两行式,桌面上限同款 180px;CSS overflow 兜底滚动)。 */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };
  return (
    <>
      {ss.phase === "ready" && cmd.open ? (
        <div className="ss-cmds" role="listbox">
          {cmd.cmdList === null ? <div className="ss-cmd-hint">{t("载入命令目录…")}</div> : null}
          {cmd.cmdList !== null && cmd.matches.length === 0 ? <div className="ss-cmd-hint">{t("无匹配命令")}</div> : null}
          {cmd.matches.map((c, i) => (
            <button
              type="button"
              key={c.name}
              role="option"
              aria-selected={i === cmd.sel}
              className={"ss-cmd" + (i === cmd.sel ? " is-sel" : "")}
              onMouseDown={(e) => { e.preventDefault(); cmd.complete(c); }}
              onMouseEnter={() => cmd.setSel(i)}
            >
              <span className="ss-cmd-name">/{c.name}</span>
              {c.hint ? <span className="ss-cmd-hint-arg">{c.hint}</span> : null}
              {c.description ? <span className="ss-cmd-desc">{c.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {ss.confirm ? <ConfirmCard key={ss.confirm.frameId} confirm={ss.confirm} onAnswer={ss.answerConfirm} /> : null}
      <div className="ss-input">
        <textarea
          className="ss-textarea"
          value={ss.draft}
          placeholder={ss.phase !== "ready" ? t("会话未就绪") : ss.busy ? t("输入下一问(排队,当前轮结束自动发送)") : t("发消息(Enter 发送,Shift+Enter 换行)")}
          disabled={ss.phase !== "ready"}
          onChange={(e) => cmd.onChange(e.target.value)}
          onInput={(e) => autoResize(e.currentTarget)}
          onKeyDown={(e) => {
            if (ss.confirm && !e.nativeEvent.isComposing && e.key === "Escape") {
              e.preventDefault();
              ss.answerConfirm(false);
              return;
            }
            /* / 命令补全优先(↑↓/Tab/Enter/Esc);未消费再走发送。 */
            if (cmd.onKey(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ss.send();
            }
          }}
        />
        <button type="button" className="ss-send" disabled={ss.phase !== "ready" || !ss.draft.trim()} onClick={ss.send}>
          {t("发送")}
        </button>
      </div>
    </>
  );
}

export function StructuredSessionTab({ tab }: { tab: EditorTab }) {
  useHost(); /* profile 注册/工作区变化 */
  const payload = tab.payload as StructuredSessionPayload;
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const profile = host.getCliProfile(payload.profileId);
  const ss = useSsSession(payload);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cmd = useCmdComplete(ss.sessionRef.current, ss.draft, ss.setDraft);

  /* 贴底跟随(busy 流式期),上翻停跟。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && ss.stickRef.current) el.scrollTop = el.scrollHeight;
  }, [ss.blocks, ss.stickRef]);


  if (!profile?.structuredRpc) {
    return <div className="ss-root"><div className="ss-empty">{t("该引擎不支持结构化会话")}</div></div>;
  }
  return (
    <div className="ss-root">
      <SsHeader
        profileId={payload.profileId}
        cwd={payload.cwd}
        model={ss.model}
        thinkingLevel={ss.thinkingLevel}
        sessionId={ss.sessionId}
        stats={ss.stats}
        busy={ss.busy}
        queued={ss.queued}
        ready={ss.phase === "ready"}
        minimal={minimal}
        statusText={ss.statusText}
        session={ss.sessionRef.current}
        onStateRefresh={(s) => ss.onStateRefresh(s)}
        onAbort={() => void ss.sessionRef.current?.abort()}
      />
      <div
        className="ss-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) ss.stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
        }}
      >
        <PhaseBanners
          phase={ss.phase}
          statusText={ss.statusText}
          sessionId={ss.sessionId}
          resumable={!!profile.structuredRpc.resumeArgs && !!ss.sessionId}
          onRetry={ss.retry}
        />

        {ss.blocks.length > 0 ? (
          <div className="ss-blocks">
            <TranscriptView blocks={ss.blocks.slice(0, ss.turnStart)} Markdown={MarkdownBody} minimal={minimal} />
            <LiveTurn blocks={ss.blocks.slice(ss.turnStart)} busy={ss.busy} Markdown={MarkdownBody} thinkingLabel={t("思考中…")} />
          </div>
        ) : null}
      </div>
      {/* working 带移出滚动区(flex:none 底带):长轮次卷走看不见、与 860px 列错位两症同治 */}
      {ss.busy ? (
        <div className="ss-working">
          <span className="ss-spin-grid" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
          <span className="ss-working-who">{ss.model?.id ?? profile.name}</span>
          <span className="ss-working-for">{t("working for")}{ss.elapsed}s</span>
        </div>
      ) : null}
      <Composer ss={ss} cmd={cmd} />
    </div>
  );
}
