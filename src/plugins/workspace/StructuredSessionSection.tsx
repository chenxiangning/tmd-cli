/**
 * 带渲染的会话区 —— 左栏 RPC 结构化会话分区(RPC 会话体系对齐规划批次 1/2/5,
 * docs/brainstorm/2026-11-05-rpc-session-parity-plan.md)。
 * 数据 = kernel structuredSessionTabs 行投影:tab 生命周期即行生命周期
 * (open 即出行、close 即剔行);不进 workspace sessions 派生链
 * (R-PTY0:分组折叠/归档视图/hygiene 扫描不波及本区,本区也不影响它们)。
 * 行点击激活中央 structured tab(R-ISO2);关闭钮 = closeTab(kill 链路既有)。
 * 批次 5:行右键菜单(跳转/重命名/静音/关闭)—— 覆盖层走 kernel 自有键,
 * 不接 sessionTitles/sessionMutes(PTY sessionId 键,零共享)。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Bell, BellSlash, CaretDown, CaretRight, Chats, Pencil, X } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { clampMenuPosition } from "./utils";
import { closeTab, setActiveTab, updateTab, useEditorTabs } from "@kernel/tabs";
import {
  isSsMuted,
  noteSsTitleOverride,
  readSsTitleOverride,
  toggleSsMute,
  useStructuredSessionRows,
  type StructuredSessionRow,
} from "@kernel/structuredSessionTabs";
import { ssSection } from "./sectionCollapsed";

/** 秒数 → 「XmYs/XhYmZs/Ys」行内计时(busy 行)。 */
function elapsedText(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

/** 行右键菜单(最小集 + 重命名/静音;PTY 菜单组件不共用 —— props 面全是 PTY 语义)。 */
function SsRowMenu({ row, position, onRename, onClose }: {
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

function SsRow({ row, active, now, renaming, onCommitRename, onContextMenu }: {
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

export function StructuredSessionSection() {
  useHost(); /* profile 注册变化(引擎图标/名称) */
  const rows = useStructuredSessionRows();
  const collapsed = ssSection.use();
  const activeId = useEditorTabs().activeId;
  /* working 计时:存在 busy 行才起 1s tick(行数少,分区级单 interval)。 */
  const [now, setNow] = useState(() => Date.now());
  const anyBusy = rows.some((r) => r.busy);
  useEffect(() => {
    if (!anyBusy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyBusy]);
  /* 右键菜单与改名态(单例:同时至多一行在改名,PTY startRename 同律)。 */
  const [menu, setMenu] = useState<{ row: StructuredSessionRow; x: number; y: number } | null>(null);
  const [renamingTab, setRenamingTab] = useState<{ id: string; initial: string } | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="running-zone" data-structured-section="">
      <button
        type="button"
        className={`running-zone-header${collapsed ? " is-collapsed" : ""}`}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("展开带渲染的会话区") : t("收起带渲染的会话区")}
        onClick={() => ssSection.set(!collapsed)}
      >
        <Chats size="1rem" className="pinned-sessions-header-icon" aria-hidden />
        <span className="running-zone-header-label">{t("带渲染的会话")}</span>
        <span className="pinned-sessions-header-count">· {rows.length}</span>
        {collapsed ? (
          <CaretRight size="0.75rem" className="pinned-sessions-header-chevron" aria-hidden />
        ) : (
          <CaretDown size="0.75rem" className="pinned-sessions-header-chevron" aria-hidden />
        )}
      </button>
      {!collapsed &&
        rows.map((row) => (
          <SsRow
            key={row.tabId}
            row={row}
            active={row.tabId === activeId}
            now={now}
            renaming={renamingTab?.id === row.tabId ? { profileId: row.profileId, cliSessionId: row.cwd, current: renamingTab.initial } : null}
            onCommitRename={(value) => {
              setRenamingTab(null);
              if (value === null) return; /* Esc = 取消 */
              const next = value.trim();
              if (next && next !== row.title) {
                noteSsTitleOverride(row.profileId, row.cwd, next);
                updateTab(row.tabId, { title: next });
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ row, ...clampMenuPosition(e.clientX, e.clientY) });
            }}
          />
        ))}
      {menu && (
        <SsRowMenu
          row={menu.row}
          position={{ x: menu.x, y: menu.y }}
          onRename={() => {
            setRenamingTab({
              id: menu.row.tabId,
              initial: readSsTitleOverride(menu.row.profileId, menu.row.cwd) ?? menu.row.title,
            });
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
