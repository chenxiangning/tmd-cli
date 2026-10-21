/**
 * ports · RowCtx 装配 —— 把扫描/派生/行动作三源缝成行渲染上下文(纯函数无 hook,
 * PortsView 复杂度分装)。行点击/键盘 Enter/Space 均弹详情,动作区由行内按钮自行消费。
 */

import type { Dispatch, SetStateAction } from "react";
import { host } from "@kernel/host";
import { openExternalUrl } from "@kernel/ipc";
import { rowKey } from "./portsTree";
import type { RowCtx } from "./PortsRows";
import type { OsKind, OwnerSession, PortEntry } from "./types";

export interface RowCtxSources {
  os: OsKind;
  newKeys: ReadonlySet<string>;
  killing: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  flash: string | null;
  ownerByRow: Map<string, OwnerSession | null>;
  wsNames: Map<string, string>;
}

export interface RowCtxActions {
  copyKind: (kind: "url" | "kill", entry: PortEntry) => void;
  askKill: (entry: PortEntry) => void;
}

export function buildRowCtx(
  s: RowCtxSources,
  a: RowCtxActions,
  setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>,
  setDetail: (entry: PortEntry | null) => void,
): RowCtx {
  return {
    os: s.os,
    newKeys: s.newKeys,
    killing: s.killing,
    collapsed: s.collapsed,
    flash: s.flash,
    ownerOf: (e) => s.ownerByRow.get(rowKey(e)) ?? null,
    wsNameOf: (root) => (root ? s.wsNames.get(root.replace(/\/+$/, "")) ?? null : null),
    onToggle: (key) =>
      setCollapsed((prev) => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      }),
    onOpenUrl: (port) => void openExternalUrl(`http://localhost:${port}`),
    onCopy: a.copyKind,
    onKillAsk: a.askKill,
    onJumpSession: (id) => host.setActiveSession(id),
    onDetail: setDetail,
  };
}
