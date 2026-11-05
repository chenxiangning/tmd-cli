/**
 * 带渲染的会话行共享件 —— 「带渲染的会话」分区行装配(活行 SsRow + 结束
 * 存续行 SsEndedRow)。RPC kind chip(R-ISO1):与 PTY 行(同引擎图标)一眼
 * 可辨。RPC 行呈现面 = 工作区卡片内的本分区分区(图 2 结构:工作区内区分
 * 终端会话与带渲染会话;2026-11-05 定稿),关闭会话经结束账本在本小节存续,
 * 不落入 PTY 磁盘历史。
 */

import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Bell, BellSlash, Pencil, X } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { clampMenuPosition } from "./utils";
import { closeTab, setActiveTab } from "@kernel/tabs";
import { isSsMuted, toggleSsMute, openStructuredSessionTab, type StructuredSessionRow } from "@kernel/structuredSessionTabs";
import { dismissClosedSsSession, type ClosedSsSession } from "@kernel/structuredSessionEnded";

/** 秒数 → 「XmYs/XhYmZs/Ys」行内计时(busy 行)。 */
function elapsedText(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

/** 行右键菜单(最小集 + 重命名/静音;PTY 菜单组件不共用 —— props 面全是 PTY 语义)。 */
export function SsRowMenu({ row, position, onRename, onClose }: {
  row: StructuredSessionRow;
  position: { x: number; y: number };
  onRename: () => void;
  onClose: () => void;
}) {
  useEscClose(onClose);
  const muted = isSsMuted(row.profileId, row.cwd);
  const pos = clampMenuPosition(position.x, position.y);
  const item = (icon: React.ReactNode, label: string, run: () => void, danger = false) => (
    <button
      type="button"
      className="wsmenu-item"
      onClick={() => {
        run();
        onClose();
      }}
      style={danger ? { color: "var(--tmd-danger, #e5484d)" } : undefined}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
  return createPortal(
    <>
      <div className="wsmenu-backdrop" role="presentation" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="wsmenu session-menu" data-icon-decor="menu" style={{ left: pos.x, top: pos.y }}>
        {item(<ArrowCounterClockwise size="0.8125rem" />, t("跳转到会话"), () => setActiveTab(row.tabId))}
        {item(<Pencil size="0.8125rem" />, t("重命名"), onRename)}
        {item(muted ? <BellSlash size="0.8125rem" /> : <Bell size="0.8125rem" />, muted ? t("取消静音通知") : t("静音通知"), () => toggleSsMute(row.profileId, row.cwd))}
        {item(<X size="0.8125rem" />, t("关闭会话"), () => closeTab(row.tabId), true)}
      </div>
    </>,
    document.body,
  );
}

export function SsRow({ row, active, now, renaming, onCommitRename, onContextMenu }: {
  row: StructuredSessionRow;
  active: boolean;
  now: number;
  renaming: RenameTarget | null;
  onCommitRename: (value: string | null) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const profile = host.getCliProfile(row.profileId);
  if (renaming) {
    return (
      <div className="thread-row is-renaming">
        <span className="tl-node is-idle" aria-hidden />
        <RenameInput target={renaming} onCommit={onCommitRename} />
      </div>
    );
  }
  return (
    /* 嵌套交互治理(LiveSessionRow 同律):关闭钮是真 button,作 DOM 兄弟骑在
       .thread-row-host 上,hover/焦点显形吃 host。 */
    <span className="thread-row-host">
      <button
        type="button"
        className={`thread-row${active ? " active" : ""}`}
        onClick={() => setActiveTab(row.tabId)}
        onContextMenu={onContextMenu}
      >
        <span
          className={`tl-node${row.waitingConfirm ? " is-ask" : row.busy ? " is-run" : row.unread > 0 ? " is-unread" : " is-idle"}`}
          aria-hidden
        />
        <span className="thread-engine-badge" title={profile?.name ?? row.profileId} aria-hidden>
          {profile?.renderIcon?.("0.75rem")}
        </span>
        {/* RPC kind chip:行装配自带身份标识,两种容器(全局分区/工作区组)同出。 */}
        <span className="thread-rpc-badge" title={t("带渲染的会话")} aria-hidden>RPC</span>
        <span className="thread-name">{row.title}</span>
        {row.busy && row.busySince != null && (
          <span className="ss-row-timer">{elapsedText(row.busySince, now)}</span>
        )}
        {row.unread > 0 && <span className="ss-row-unread">{row.unread}</span>}
      </button>
      <button
        type="button"
        className="ss-row-close"
        title={t("关闭会话")}
        aria-label={t("关闭会话")}
        onClick={() => closeTab(row.tabId)}
      >
        <X size="0.625rem" aria-hidden />
      </button>
    </span>
  );
}

/** 结束 RPC 会话行(关闭账本存续):灰点 + 原标题,RPC chip 保留身份可辨;
 *  点行 = resume 重开(账本由活行去重隐去),X = 移除(回落磁盘历史)。 */
export function SsEndedRow({ row, active }: {
  row: ClosedSsSession;
  active: boolean;
}) {
  const profile = host.getCliProfile(row.profileId);
  return (
    <span className="thread-row-host">
      <button
        type="button"
        className={`thread-row${active ? " active" : ""}`}
        title={t("继续对话(带渲染的会话)")}
        onClick={() => openStructuredSessionTab(row.profileId, row.cwd, { resumeSessionId: row.sessionId, resumeUnsettled: row.busy === true })}
      >
        <span className="tl-node is-idle" aria-hidden />
        <span className="thread-engine-badge" title={profile?.name ?? row.profileId} aria-hidden>
          {profile?.renderIcon?.("0.75rem")}
        </span>
        <span className="thread-rpc-badge" title={t("带渲染的会话")} aria-hidden>RPC</span>
        <span className="thread-name">{row.title}</span>
        <span className="ss-row-ended-tag">{t("已结束")}</span>
      </button>
      <button
        type="button"
        className="ss-row-close"
        title={t("移除记录")}
        aria-label={t("移除记录")}
        onClick={() => dismissClosedSsSession(row.sessionId)}
      >
        <X size="0.625rem" aria-hidden />
      </button>
    </span>
  );
}
