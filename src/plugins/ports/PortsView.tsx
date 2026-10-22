/**
 * ports · 端口管理中央 tab —— 装配面:扫描生命周期(usePortsScan)、行数据派生
 * (usePortRows)、行动作(usePortActions)在此缝合成家族列表 + 工具栏 + kill 二次确认。
 * 数据面在 portsScan/portsTree 纯模块,工具栏/告警在 PortsChrome,行在 PortsRows。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { detectOs } from "./platform";
import { rowKey, hasAlerts } from "./portsTree";
import { PortsToolbar, PortsBody, ViewAlerts } from "./PortsChrome";
import { PortDetailDialog } from "./PortDetail";
import { buildRowCtx } from "./rowCtx";
import { usePortsScan } from "./usePortsScan";
import { usePortActions } from "./usePortActions";
import { usePortRows } from "./usePortRows";
import type { OsKind, PortEntry, SortKey, SortSpec } from "./types";
import "./locales";

export function PortsView() {
  const { outcome, loading, error, notice, timedOut, setNotice, auto, toggleAuto, newKeys, wsNames, refresh } =
    usePortsScan();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [detail, setDetail] = useState<PortEntry | null>(null);

  const os: OsKind = outcome?.os ?? detectOs();
  const { killing, confirmTarget, flash, askKill, cancelKill, confirmKill, copyKind } = usePortActions(
    os,
    refresh,
    setNotice,
  );
  const { groups, filtered, shownRows, ownerByRow, procCount } = usePortRows(outcome, filter, sort, wsNames);

  /* 批量折叠/展开:作用于全部组(不过滤集);仅带子行的组有折叠意义。 */
  const foldableKeys = groups.filter((g) => g.children.length > 0).map((g) => rowKey(g.top));
  const collapseAll = () => setCollapsed(new Set(foldableKeys));
  const expandAll = () => setCollapsed(new Set());
  /* 列头排序:点同列换向,点新列升序起步;第三次点同列回默认(家族端口序)。 */
  const onSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  const ctx = buildRowCtx(
    { os, newKeys, killing, collapsed, flash, ownerByRow, wsNames },
    { copyKind, askKill },
    setCollapsed,
    setDetail,
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <PortsToolbar
        loading={loading}
        auto={auto}
        filter={filter}
        ports={outcome?.rows.length ?? 0}
        shown={shownRows}
        procs={procCount}
        os={os}
        source={outcome?.source ?? "—"}
        onRefresh={() => void refresh()}
        onToggleAuto={toggleAuto}
        onFilter={setFilter}
        onCollapseAll={collapseAll}
        onExpandAll={expandAll}
        canFoldAll={foldableKeys.length > 0}
      />
      {hasAlerts(error, notice, timedOut, outcome, os) && (
        <div className="px-3 pt-2">
          <ViewAlerts error={error} notice={notice} timedOut={timedOut} outcome={outcome} os={os} />
        </div>
      )}
      <PortsBody
        filtered={filtered}
        sort={sort}
        onSort={onSort}
        ctx={ctx}
        loading={loading}
        filter={filter}
        onRefresh={() => void refresh()}
        onClearFilter={() => setFilter("")}
      />
      {detail && (
        <PortDetailDialog
          entry={detail}
          os={os}
          ws={detail.gitRoot ? (wsNames.get(detail.gitRoot.replace(/\/+$/, "")) ?? null) : null}
          owner={ownerByRow.get(rowKey(detail)) ?? null}
          isNew={newKeys.has(rowKey(detail))}
          flash={flash}
          onOpenUrl={ctx.onOpenUrl}
          onCopy={copyKind}
          onKillAsk={(entry) => {
            setDetail(null);
            askKill(entry);
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {confirmTarget && (
        <ConfirmDialog
          title={t("确认终止进程")}
          danger
          confirmLabel={t("终止进程")}
          message={t("结束监听 {addr}:{port} 的进程 pid {pid}?对应服务将停止。", {
            addr: confirmTarget.addr,
            port: confirmTarget.port,
            pid: confirmTarget.pid ?? 0,
          })}
          onConfirm={() => void confirmKill()}
          onClose={cancelKill}
        />
      )}
    </div>
  );
}
