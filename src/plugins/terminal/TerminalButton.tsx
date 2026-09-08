/**
 * 内置终端入口按钮 —— 头部左区按钮簇(header.leftCluster 挂点贡献)。
 *
 * 点击:聚焦最新 shell 会话,无则新建;Option/Alt+点击强制新建。
 * 在途创建单例闸:spawn 是异步 IPC,不收口则双击开出两个 zsh
 * (先例:sessionSpawn.openingDiskSessions)。
 */

import { TerminalWindow } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";

/** 在途创建 Promise(shell 会话 spawn 装配未落地期间再点直接忽略)。 */
let creating: Promise<unknown> | null = null;

export function TerminalButton() {
  useHost(); /* 活跃指针/会话表变化驱动激活态与聚焦语义 */
  const activeId = host.getActiveSessionId();
  const isActive =
    host.getSessions().find((s) => s.id === activeId)?.kind === "shell";

  const open = (forceNew: boolean) => {
    if (creating) return;
    if (!forceNew) {
      /* 聚焦最新(createdAt 最大)的 shell 会话;无则落到新建 */
      const latest = host
        .getSessions()
        .filter((s) => s.kind === "shell")
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      if (latest) {
        host.setActiveSession(latest.id);
        return;
      }
    }
    /* 失败已广播 sessionStartFailed(StartFailureToast 呈现),这里吞掉即可 */
    creating = host
      .createShellSession()
      .catch(() => undefined)
      .finally(() => {
        creating = null;
      });
  };

  return (
    <button
      type="button"
      className={`titlebar-action${isActive ? " is-active" : ""}`}
      aria-label="内置终端"
      title="内置终端(Option+点击新建)"
      onClick={(e) => open(e.altKey)}
    >
      <TerminalWindow size="0.875rem" aria-hidden />
    </button>
  );
}
