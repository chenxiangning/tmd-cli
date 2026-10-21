/**
 * ports · 端口管理中央 tab —— 装配面:扫描生命周期(usePortsScan)、行数据派生
 * (usePortRows)、行动作(usePortActions)在此缝合成家族列表 + 工具栏 + kill 二次确认。
 * 数据面在 portsScan/portsTree 纯模块,工具栏/告警在 PortsChrome,行在 PortsRows。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { host } from "@kernel/host";
import { openExternalUrl } from "@kernel/ipc";
import { detectOs } from "./platform";
import { rowKey } from "./portsTree";
import { PortGroupBlock, PortListHeader, type RowCtx } from "./PortsRows";
import { PortsToolbar, PortsEmpty, ViewAlerts } from "./PortsChrome";
import { usePortsScan } from "./usePortsScan";
import { usePortActions } from "./usePortActions";
import { usePortRows } from "./usePortRows";
import type { OsKind } from "./types";
import "./locales";

export function PortsView() {
  const { outcome, loading, error, notice, setNotice, auto, toggleAuto, newKeys, wsNames, refresh } =
    usePortsScan();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const os: OsKind = outcome?.os ?? detectOs();
  const { killing, confirmTarget, flash, askKill, cancelKill, confirmKill, copyKind } = usePortActions(
    os,
    refresh,
    setNotice,
  );
  const { filtered, shownRows, ownerByRow, procCount } = usePortRows(outcome, filter);

  const ctx: RowCtx = {
    os,
    newKeys,
    killing,
    collapsed,
    flash,
    ownerOf: (e) => ownerByRow.get(rowKey(e)) ?? null,
    wsNameOf: (root) => (root ? wsNames.get(root.replace(/\/+$/, "")) ?? null : null),
    onToggle: (key) =>
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      }),
    onOpenUrl: (port) => void openExternalUrl(`http://localhost:${port}`),
    onCopy: copyKind,
    onKillAsk: askKill,
    onJumpSession: (id) => host.setActiveSession(id),
  };

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
      />
      {(error || notice || (outcome && outcome.warnings.length > 0) || os === "windows") && (
        <div className="px-3 pt-2">
          <ViewAlerts error={error} notice={notice} outcome={outcome} os={os} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
        {filtered.length === 0 ? (
          <PortsEmpty
            loading={loading}
            filter={filter}
            onRefresh={() => void refresh()}
            onClearFilter={() => setFilter("")}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PortListHeader />
            {filtered.map((g) => (
              <PortGroupBlock key={rowKey(g.top)} group={g} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
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
