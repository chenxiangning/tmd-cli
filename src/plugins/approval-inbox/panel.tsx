/**
 * 审批收件箱面板 —— 右栏「审批」页签。
 * 行 = 等待确认会话:引擎图标 + 标题(与 tab 条同源解析链)+ 等待时长 + 面板页脚摘录;
 * 动作 = 直达并聚焦幕布(gotoAndFocus:切激活 + xterm 聚焦,拒绝/按键在幕布内完成)
 * 与自由文本应答(原样 writeSession,回车发送)。预设「同意/拒绝」代发键
 * 不做:各 CLI 键位语义不一,发错键=批错操作(M2 评审 A2 拍板,桌面同律)。
 */
import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { getSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";
import {
  answerKeys,
  answerWaiting,
  dismissFailure,
  gotoAndFocus,
  observeCurrentWaitings,
  useApprovalInbox,
  type InboxEntry,
} from "./store";
import { jumpTabKeys, moveKeys, type AskCard } from "./askCard";

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
      {entries.length > 0 && (
        <div className="flex-none border-b border-(--tmd-border) px-3 py-1 text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-faint)">
          {t("允许/拒绝请按该 CLI 自己的键位:「直达」进幕布操作;这里只代发文本")}
        </div>
      )}
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

  /** 直发应答文本(选项键位/总结态回车/草稿原文共用);空串 = 仅回车。 */
  const sendText = async (text: string): Promise<void> => {
    if (sending) return;
    setSending(true);
    try {
      if (await answerWaiting(entry.sessionId, text)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (text) void sendText(text);
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
          onClick={() => gotoAndFocus(entry.sessionId)}
        >
          {t("直达")}
        </button>
      </div>
      {entry.card ? (
        <CardBlock card={entry.card} sessionId={entry.sessionId} />
      ) : (
        entry.excerpt && (
          <pre
            title={entry.excerpt}
            aria-label={t("摘录以会话面板为准")}
            className="mt-1 max-h-[3.375rem] overflow-hidden font-mono text-[0.625rem] leading-[1.125rem] whitespace-pre-wrap text-(--tmd-fg-muted)"
          >
            {entry.excerpt}
          </pre>
        )
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

/** omp ask 卡操作面板。键位语义取自 pi-tui overlays/ask-dialog.ts 源码(权威,非页脚推断):
 * - select 题(单选):Enter = 选当前光标项并自动跳下一题(多问)/即选即提交(单问);无数字直选。
 * - multi 题(多选):空格 = toggle 光标项;Enter = 确认当前选择跳下一题。
 * - ⇥ 全程可切 tab;Submit tab 上 Enter = 提交。
 * 面板代发:选项点击 = ↑/↓ 移到该项 + Enter(select)/空格(multi);题 pill = ⇥×k;
 * Submit pill = ⇥×k + 回车。光标基准用解析帧值(1-2 拍刷新回真),连点快于帧刷新
 * 或在幕布手动动过光标会漂移 —— title 已注明以幕布为准。 */
function CardBlock({ card, sessionId }: { card: AskCard; sessionId: string }) {
  const multi = card.kind === "multi";
  const questionCount = card.tabs.length > 0 ? card.tabs.length - 1 : 1;
  const send = (keys: string) => void answerKeys(sessionId, keys);

  const pickOption = (i: number) => send(moveKeys(card.cursor, i) + (multi ? " " : "\n"));
  const jumpTo = (target: number) => send(jumpTabKeys(0, target, card.tabs.length));
  const submit = () => send(jumpTabKeys(0, card.tabs.length - 1, card.tabs.length) + "\n");

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        <span title={card.question} className="min-w-0 truncate text-[0.6875rem] leading-[1.125rem] text-(--tmd-fg)">
          {card.question}
        </span>
        {questionCount > 1 && (
          <span className="flex-none rounded bg-(--tmd-bg-subtle) px-1 text-[0.5625rem] leading-[1rem] text-(--tmd-warn)">
            {t("{n} 个问题", { n: questionCount })}
          </span>
        )}
      </div>
      {card.tabs.length > 0 && (
        <div className="mt-1 flex items-center gap-1">
          {card.tabs.map((name, i) => {
            const isSubmit = i === card.tabs.length - 1;
            return (
              <button
                key={name}
                type="button"
                title={
                  isSubmit
                    ? t("提交全部答案(⇥ 到 Submit + 回车)")
                    : t("切到「{name}」(⇥ 跳题)", { name })
                }
                onClick={() => (isSubmit ? submit() : jumpTo(i))}
                className="rounded bg-(--tmd-bg-subtle) px-1 py-0.5 text-[0.5625rem] leading-[1rem] text-(--tmd-fg-muted) hover:text-(--tmd-accent)"
              >
                {isSubmit ? `⏎ ${name}` : name}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex flex-col items-stretch gap-0.5">
        {card.options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            title={t("选择该项并推进(↑/↓ + {key});若在幕布手动动过光标,以幕布为准", {
              key: multi ? t("空格勾选") : "⏎",
            })}
            onClick={() => pickOption(i)}
            className="flex items-center gap-1.5 rounded border border-(--tmd-border) px-1.5 py-0.5 text-left text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-muted) hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
          >
            {multi && card.cursor === i && (
              <span aria-hidden className="font-mono text-[0.5625rem] text-(--tmd-accent)">
                ❯
              </span>
            )}
            <span className="min-w-0 truncate">{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
