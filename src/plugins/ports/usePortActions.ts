/**
 * ports · 行动作 hook —— 复制闪态(地址/kill 命令)与 kill 二段确认
 * (确认目标 + killing 集合 + 执行后重扫)。PortsView 只负责把它缝进 RowCtx。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { copyText } from "@kernel/clipboard";
import { killCommand, killListener } from "./portsKill";
import { rowKey } from "./portsTree";
import type { OsKind, PortEntry } from "./types";

export interface PortActions {
  killing: ReadonlySet<string>;
  confirmTarget: PortEntry | null;
  flash: string | null;
  askKill: (entry: PortEntry) => void;
  cancelKill: () => void;
  confirmKill: () => Promise<void>;
  copyKind: (kind: "url" | "kill", entry: PortEntry) => void;
}

export function usePortActions(
  os: OsKind,
  refresh: () => Promise<void>,
  setNotice: (msg: string | null) => void,
): PortActions {
  const [killing, setKilling] = useState<ReadonlySet<string>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<PortEntry | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const copyKind = (kind: "url" | "kill", entry: PortEntry) => {
    const flashKey = `${rowKey(entry)}:${kind}`;
    const text = kind === "url" ? `http://localhost:${entry.port}` : killCommand(entry.pid ?? 0, os);
    void copyText(text)
      .then(() => {
        setFlash(flashKey);
        setTimeout(() => setFlash((f) => (f === flashKey ? null : f)), 1200);
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  };

  const confirmKill = async () => {
    const entry = confirmTarget;
    if (!entry || entry.pid == null) return;
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
  };

  return {
    killing,
    confirmTarget,
    flash,
    askKill: setConfirmTarget,
    cancelKill: () => setConfirmTarget(null),
    confirmKill,
    copyKind,
  };
}
