/**
 * 通知中心面板 —— 右栏「通知中心」页签。
 * 行 = 通知流水(log.ts 单文件全量历史,聚焦静默/免打扰也记):
 * 时刻 + 类别标题 + 摘录;行点击 = 会话回跳(sessionViewRequested 用户手势语义
 * + 激活/恢复会话):活会话聚焦;tab 已关/重启过的按记录时刻的磁盘身份快照
 * resume 重开(host.openDiskSession,与侧栏磁盘行同语义)。
 * quota 类无单一会话语义,点击弹详情(记录时刻的预警文案)。
 * 「清空」两步武装确认(首击进入确认态,3s 无操作回弹;仿 DangerAction)。
 */

import { useEffect, useState } from "react";
import { BellRinging, BellSlash } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { sessionMuteModeLabel, tmdSessionMuteKey, unmuteSession, type SessionMuteEntry } from "@kernel/sessionMutes";
import { Empty } from "@kernel/Empty";
import { DialogShell } from "@kernel/DialogShell";
import { formatDate, formatTime } from "@kernel/relativeTime";
import { clearNotifyLog, groupNotifyEntries, useNotifyLog, type NotifyEntry } from "./log";
import { reopenNotifySession } from "./logic";

/** 行点击回跳:先发用户手势(摘最大化),激活/恢复决策见 logic.reopenNotifySession。 */
function reopenEntry(entry: NotifyEntry): void {
  host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
  reopenNotifySession(entry, host);
}

/** 额度预警详情弹层:呈现记录时刻的预警标题/正文/时间(快照,不回查现值)。 */
function QuotaDetailDialog({ entry, onClose }: { entry: NotifyEntry; onClose: () => void }) {
  return (
    <DialogShell
      title={entry.title}
      icon={null}
      width={480}
      zClass="z-[1201]" /* 右栏层叠上下文压 z-1000(WorktreeManageDialog 先例) */
      onClose={onClose}
      footer={null}
    >
      <div className="flex flex-col gap-2 text-xs">
        <div className="text-(--tmd-fg-subtle)">
          {t("记录时间:{t}", { t: `${formatDate(entry.ts)} ${formatTime(entry.ts)}` })}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed text-(--tmd-fg)">{entry.snippet}</div>
      </div>
    </DialogShell>
  );
}

/** 单行流水。today 决定时刻档位(今日只显 HH:mm,更早补日期)。
 *  静音会话的条目:斜铃 + 档位标(OS/声音已被闸,流水照记),附取消钮。 */
function EntryRow({
  entry,
  today,
  muteEntry,
  onUnmute,
  onOpen,
  onDetail,
}: {
  entry: NotifyEntry;
  today: boolean;
  muteEntry?: SessionMuteEntry;
  onUnmute?: () => void;
  onOpen: () => void;
  onDetail: () => void;
}) {
  const stamp = today ? formatTime(entry.ts) : `${formatDate(entry.ts)} ${formatTime(entry.ts)}`;
  const content = (
    <>
      <div className="flex items-baseline gap-1.5">
        <span className="flex-none font-mono text-2xs text-(--tmd-fg-faint)">{stamp}</span>
        {muteEntry ? (
          <BellSlash
            size="0.75rem"
            className="flex-none self-center text-(--tmd-fg-faint)"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-meta text-(--tmd-fg-muted)">{entry.title}</span>
        {muteEntry ? (
          <span className="flex-none text-2xs text-(--tmd-fg-faint)" title={t("该会话的通知已静音")}>
            {sessionMuteModeLabel(muteEntry.mode)}
            {muteEntry.mode === "full" && muteEntry.askRing !== true ? ` · ${t("ask 亦静")}` : ""}
          </span>
        ) : null}
      </div>
      {entry.snippet && (
        <div className="truncate pl-1 text-2xs text-(--tmd-fg-faint)" title={entry.snippet}>
          {entry.snippet}
        </div>
      )}
    </>
  );
  const unmuteBtn = muteEntry && onUnmute ? (
    <button
      type="button"
      className="flex-none px-1 text-2xs text-(--tmd-fg-faint) hover:underline"
      onClick={onUnmute}
    >
      {t("取消静音")}
    </button>
  ) : null;
  if (entry.kind === "quota") {
    /* 额度预警无单一会话语义(监控面 = 多会话按供应商归并),不支持回跳;点击弹详情。 */
    return (
      <div className="flex items-center pr-1">
        <button
          type="button"
          className="block min-w-0 flex-1 px-3 py-1.5 text-left hover:bg-(--tmd-bg-hover)"
          title={t("查看预警详情")}
          onClick={onDetail}
        >
          {content}
        </button>
        {unmuteBtn}
      </div>
    );
  }
  return (
    <div className="flex items-center pr-1">
      <button
        type="button"
        className="block min-w-0 flex-1 px-3 py-1.5 text-left hover:bg-(--tmd-bg-hover)"
        title={t("回跳并激活该会话")}
        onClick={onOpen}
      >
        {content}
      </button>
      {unmuteBtn}
    </div>
  );
}

/** 清空按钮(两步武装:首击只进确认态,3s 回弹;再击执行)。 */
function ClearAllButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`flex-none text-2xs hover:underline ${
        armed ? "text-(--tmd-diff-removed)" : "text-(--tmd-fg-faint)"
      }`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          clearNotifyLog();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? t("确认清空?") : t("清空")}
    </button>
  );
}

/** 分组段头(今日/更早)。 */
function GroupHead({ label }: { label: string }) {
  return (
    <div className="border-b border-(--tmd-border) px-3 py-1 text-2xs text-(--tmd-fg-faint)">
      {label}
    </div>
  );
}

export function NotifyCenterPanel() {
  const entries = useNotifyLog();
  const { settings } = useSettingsState(); /* 静音覆盖层:取消钮与斜铃标随档实时 */
  const [quotaDetail, setQuotaDetail] = useState<NotifyEntry | null>(null);
  const { today, earlier } = groupNotifyEntries(entries, new Date());
  const muteProps = (e: NotifyEntry) => {
    const muteKey = tmdSessionMuteKey(e.sessionId, host);
    const muteEntry = muteKey === undefined ? undefined : settings.sessionMutes[muteKey];
    return {
      muteEntry,
      onUnmute:
        muteEntry !== undefined && muteKey !== undefined ? () => unmuteSession(muteKey) : undefined,
      onOpen: () => reopenEntry(e),
      onDetail: () => setQuotaDetail(e),
    };
  };
  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)" data-testid="notify-center-panel">
      <div className="flex flex-none items-center justify-between border-b border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted)">
        <span>{t("通知流水 · {n} 条", { n: entries.length })}</span>
        {entries.length > 0 && <ClearAllButton />}
      </div>
      {entries.length === 0 ? (
        <Empty icon={<BellRinging aria-hidden />}>
          {t("暂无通知记录;等待确认/轮次结束/会话退出/额度预警都会记在这里")}
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {today.length > 0 && <GroupHead label={t("今日")} />}
          {today.map((e) => (
            <EntryRow key={e.id} entry={e} today {...muteProps(e)} />
          ))}
          {earlier.length > 0 && <GroupHead label={t("更早")} />}
          {earlier.map((e) => (
            <EntryRow key={e.id} entry={e} today={false} {...muteProps(e)} />
          ))}
        </div>
      )}
      {quotaDetail && (
        <QuotaDetailDialog entry={quotaDetail} onClose={() => setQuotaDetail(null)} />
      )}
    </div>
  );
}
