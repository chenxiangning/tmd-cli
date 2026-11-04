/**
 * 右栏「远程」落地页决策纯逻辑(F-02)——组件文件不导出非组件铁则。
 *
 * 视图三态:有 SSH 会话 → 整页交回 SshPanel(连接卡/转发/SFTP 不重构);
 * 当前工作区是 WSL 来源 → WSL 状态 + 打开按钮;其余(纯本地)→ 空态引导。
 * 纯本地会话/工作区不会被误认:SSH 只看会话 kind,WSL 只看 workspaceOrigins 认领。
 */

import type { Workspace } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";

export type RemoteHomeView =
  | { kind: "ssh" }
  | { kind: "wsl"; distro: string; remote: boolean }
  | { kind: "empty" };

/** 决策:SSH 会话优先(运维现场优先),其次当前工作区的 WSL 来源,否则空态。 */
export function resolveRemoteHome(hasSshSessions: boolean, ws: Workspace | null): RemoteHomeView {
  if (hasSshSessions) return { kind: "ssh" };
  const origin = ws ? findWorkspaceOrigin(ws) : null;
  if (origin?.id === "wsl" && ws?.wsl) {
    return { kind: "wsl", distro: ws.wsl.distro, remote: !!ws.wsl.hostId };
  }
  return { kind: "empty" };
}
