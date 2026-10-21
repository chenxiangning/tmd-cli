/**
 * ports · 端口管理中央 tab —— 扫描编排消费面:状态持有 + 家族列表 + kill 二次确认。
 * 数据面全在 portsScan/portsTree 纯模块,工具栏/告警在 PortsChrome,行在 PortsRows。
 * 自动刷新 = 手动开启的 5s 前台轮询(tab 卸载即停,失焦跳过,扫描中跳过)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plugs } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { copyText } from "@kernel/clipboard";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { Empty } from "@kernel/Empty";
import { host } from "@kernel/host";
import { ipc, openExternalUrl } from "@kernel/ipc";
import { detectOs } from "./platform";
import { killCommand, killListener } from "./portsKill";
import { scanPorts } from "./portsScan";
import { findOwnerSession, groupByFamily, rowKey } from "./portsTree";
import { PortGroupBlock, type RowCtx } from "./PortsRows";
import { PortsToolbar, ViewAlerts } from "./PortsChrome";
import type { OsKind, OwnerSession, PortEntry, ScanOutcome } from "./types";
import "./locales";

const AUTO_KEY = "tmd.ports.auto";
const AUTO_MS = 5000;

export function PortsView() {
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "1");
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [killing, setKilling] = useState<ReadonlySet<string>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<PortEntry | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [wsNames, setWsNames] = useState<Map<string, string>>(new Map());
  const prevKeysRef = useRef<ReadonlySet<string>>(new Set());
  const runningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    try {
      const next = await scanPorts();
      const keys = new Set(next.rows.map(rowKey));
      if (prevKeysRef.current.size > 0) {
        setNewKeys(new Set([...keys].filter((k) => !prevKeysRef.current.has(k))));
      }
      prevKeysRef.current = keys;
      setOutcome(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    ipc
      .configReadWorkspaces()
      .then((file) => setWsNames(new Map((file.list ?? []).map((w) => [w.root.replace(/\/+$/, ""), w.name]))))
      .catch(() => {});
  }, [refresh]);

  /* 手动开启的 5s 前台轮询:失焦跳过、扫描中跳过、tab 卸载即停。 */
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !runningRef.current) void refresh();
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [auto, refresh]);

  const toggleAuto = () => {
    const next = !auto;
    localStorage.setItem(AUTO_KEY, next ? "1" : "0");
    setAuto(next);
  };

  const os: OsKind = outcome?.os ?? detectOs();
  const groups = useMemo(() => (outcome ? groupByFamily(outcome.rows) : []), [outcome]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    const hit = (r: PortEntry) =>
      [String(r.port), r.pid != null ? String(r.pid) : "", r.process, r.args, r.addr, r.cwd ?? "", r.gitRoot ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return groups
      .map((g) => ({ top: g.top, children: g.children.filter(hit) }))
      .filter((g) => hit(g.top) || g.children.length > 0);
  }, [groups, filter]);

  const ownerByRow = useMemo(() => {
    const m = new Map<string, OwnerSession | null>();
    if (!outcome) return m;
    const sessionByPid = new Map<number, OwnerSession>();
    for (const s of host.getSessions()) {
      if (s.pid != null)
        sessionByPid.set(s.pid, { id: s.id, title: s.title, profileId: s.profileId, workspaceId: s.workspaceId });
    }
    const ppidOf = (p: number) => outcome.ppidAll.get(p) ?? null;
    for (const r of outcome.rows) m.set(rowKey(r), findOwnerSession(r.pid, ppidOf, sessionByPid));
    return m;
  }, [outcome]);

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
    onCopy: (kind, entry) => {
      const flashKey = `${rowKey(entry)}:${kind}`;
      const text = kind === "url" ? `http://localhost:${entry.port}` : killCommand(entry.pid ?? 0, os);
      void copyText(text)
        .then(() => {
          setFlash(flashKey);
          setTimeout(() => setFlash((f) => (f === flashKey ? null : f)), 1200);
        })
        .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
    },
    onKillAsk: (entry) => setConfirmTarget(entry),
    onJumpSession: (id) => host.setActiveSession(id),
  };

  async function doKill(entry: PortEntry) {
    if (entry.pid == null) return;
    const key = rowKey(entry);
    setConfirmTarget(null);
    setNotice(null);
    setKilling((s) => new Set(s).add(key));
    try {
      await killListener(entry.pid, os);
      await refresh();
    } catch (e) {
      setNotice(t("终止失败:{error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setKilling((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  }

  const procCount = outcome ? new Set(outcome.rows.map((r) => r.pid).filter((p) => p != null)).size : 0;
  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <PortsToolbar
        loading={loading}
        auto={auto}
        filter={filter}
        ports={outcome?.rows.length ?? 0}
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
          <div className="flex flex-1 items-center justify-center">
            <Empty
              icon={<Plugs size="1.25rem" />}
              action={loading ? undefined : { label: t("刷新"), onClick: () => void refresh() }}
            >
              {loading ? t("正在扫描…") : t("没有监听中的 TCP 端口")}
            </Empty>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
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
          onConfirm={() => void doKill(confirmTarget)}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
}
