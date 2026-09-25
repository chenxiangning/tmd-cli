/**
 * 审批收件箱面板 —— 右栏「审批」页签。
 * 行 = 等待确认会话:引擎图标 + 标题(与 tab 条同源解析链)+ 等待时长 + 面板页脚摘录;
 * 动作 = 直达(host.setActiveSession,经 activeSessionChanged→trackOpen 兼顾重开被摘
 * 的 tab)与自由文本应答(原样 writeSession,回车发送)。预设「同意/拒绝」代发键
 * 不做:各 CLI 键位语义不一,发错键=批错操作(M2 评审 A2 拍板,桌面同律)。
 */
import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { getSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";
import {
  answerWaiting,
  dismissFailure,
  observeCurrentWaitings,
  useApprovalInbox,
  type InboxEntry,
} from "./store";

/** 等待时长文案;since 未知(面板后见)只显示「等待中」。 */
function formatWait(since: number | null): string {
  if (since === null) return t("等待中");
  const elapsed = Math.max(0, Date.now() - since);
  if (elapsed < 60_000) return t("等待 {n} 秒", { n: Math.floor(elapsed / 1000) });
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return t("等待 {n} 分钟", { n: minutes });
  return t("等待 {n} 小时", { n: Math.floor(minutes / 60) });
}

/** 标题解析:手动命名 > 打开快照 > meta 标题 > 短码(与 SessionTabBar 同源)。 */
function resolveTitle(sessionId: string, manualTitles: Record<string, string>): string {
  const meta = host.getSessions().find((s) => s.id === sessionId);
  if (!meta) return shortId(sessionId);
  const cliSessionId = host.getCliSessionId(sessionId);
  return (
    (cliSessionId ? manualTitles[sessionTitleKey(meta.profileId, cliSessionId)] : undefined) ??
    getSessionTabTitle(sessionId) ??
    meta.title ??
    shortId(sessionId)
  );
}

export function ApprovalInboxPanel() {
  useHost(); /* 状态位变化经 store 的 host.subscribe 重算,此处驱动重渲 */
  const { entries, failure } = useApprovalInbox();
  const { settings } = useSettingsState();
  const [, tick] = useState(0);
  useEffect(() => {
    observeCurrentWaitings(); /* 挂载补盲:HMR 重载后已在等待的会话 */
    const timer = window.setInterval(() => tick((n) => n + 1), 1000); /* 时长走秒 */
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div
        role="status"
        className="flex-none border-b border-(--tmd-border) px-3 py-1.5 text-[0.6875rem] leading-[1.125rem] text-(--tmd-fg-muted)"
      >
        {t("审批收件箱 · {n} 个会话在等待 · 摘录以会话面板为准", { n: entries.length })}
      </div>
      {failure && (
        <button
          type="button"
          className="flex-none border-b border-(--tmd-border) bg-(--tmd-diff-removed)/10 px-3 py-1.5 text-left text-[0.6875rem] leading-[1.125rem] text-(--tmd-diff-removed) hover:underline"
          onClick={dismissFailure}
        >
          {t("应答发送失败,会话可能已退出")} · {t("点击关闭")}
        </button>
      )}
      {entries.length === 0 ? (
        <div className="px-4 pt-10 text-center text-[0.6875rem] leading-relaxed text-(--tmd-fg-faint)">
          {t("没有会话在等待确认")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => (
            <InboxRow key={entry.sessionId} entry={entry} manualTitles={settings.sessionTitles} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxRow({ entry, manualTitles }: { entry: InboxEntry; manualTitles: Record<string, string> }) {
  const meta = host.getSessions().find((s) => s.id === entry.sessionId);
  const profile = host.getCliProfile(meta?.profileId ?? entry.profileId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false); /* 在途闸:防连按回车重复写 PTY */

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (await answerWaiting(entry.sessionId, text)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-b border-(--tmd-border) px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {profile?.renderIcon?.("0.75rem")}
        <span className="truncate text-[0.6875rem] font-semibold leading-[1.125rem] text-(--tmd-fg)">
          {resolveTitle(entry.sessionId, manualTitles)}
        </span>
        <span className="ml-auto flex-none text-[0.625rem] leading-[1.125rem] text-(--tmd-warn)">
          {formatWait(entry.since)}
        </span>
        <button
          type="button"
          className="flex-none rounded border border-(--tmd-border) px-1.5 text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-muted) hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
          onClick={() => host.setActiveSession(entry.sessionId)}
        >
          {t("直达")}
        </button>
      </div>
      {entry.excerpt && (
        <pre
          title={entry.excerpt}
          aria-label={t("摘录以会话面板为准")}
          className="mt-1 max-h-[3.375rem] overflow-hidden font-mono text-[0.625rem] leading-[1.125rem] whitespace-pre-wrap text-(--tmd-fg-muted)"
        >
          {entry.excerpt}
        </pre>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /* IME 组词回车(中文输入确认)不发送 */
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
          placeholder={t("应答原样写入会话,回车发送")}
          aria-label={t("应答原样写入会话,回车发送")}
          className="h-[1.5rem] min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-base) px-2 font-mono text-[0.6875rem] text-(--tmd-fg) placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent) focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={sending}
          className="flex-none rounded bg-(--tmd-accent) px-2 text-[0.625rem] leading-[1.25rem] text-white opacity-90 hover:opacity-100 disabled:opacity-50"
          onClick={() => void send()}
        >
          {t("发送")}
        </button>
      </div>
    </div>
  );
}
