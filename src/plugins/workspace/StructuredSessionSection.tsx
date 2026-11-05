/**
 * 带渲染的会话区 —— 左栏 RPC 结构化会话分区(RPC 会话体系对齐规划批次 1,
 * docs/brainstorm/2026-11-05-rpc-session-parity-plan.md)。
 * 数据 = kernel structuredSessionTabs 行投影:tab 生命周期即行生命周期
 * (open 即出行、close 即剔行);不进 workspace sessions 派生链
 * (R-PTY0:分组折叠/归档视图/hygiene 扫描不波及本区,本区也不影响它们)。
 * 行点击激活中央 structured tab(R-ISO2:不触碰 PTY 幕布会话与其 MRU);
 * 关闭钮 = closeTab(unmount 收割 RPC 子进程,keepAlive 语义既有)。
 * working 计时行内自算(busySince 广播一次,不逐秒广播)。
 */

import { useEffect, useState } from "react";
import { CaretDown, CaretRight, Chats, X } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { closeTab, setActiveTab, useEditorTabs } from "@kernel/tabs";
import {
  useStructuredSessionRows,
  type StructuredSessionRow,
} from "@kernel/structuredSessionTabs";
import { ssSection } from "./sectionCollapsed";

function elapsedText(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

function SsRow({ row, active, now }: { row: StructuredSessionRow; active: boolean; now: number }) {
  const profile = host.getCliProfile(row.profileId);
  return (
    /* 嵌套交互治理(LiveSessionRow 同律):关闭钮是真 button,作 DOM 兄弟骑在
       .thread-row-host 上,hover/焦点显形吃 host。 */
    <span className="thread-row-host">
      <button
        type="button"
        className={`thread-row${active ? " active" : ""}`}
        onClick={() => setActiveTab(row.tabId)}
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
          <SsRow key={row.tabId} row={row} active={row.tabId === activeId} now={now} />
        ))}
    </div>
  );
}
