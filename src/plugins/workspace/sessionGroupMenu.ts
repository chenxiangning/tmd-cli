/**
 * 会话分组菜单/重命名/删除/扎点接线(自 SessionList 拆出:文件规模与
 * react-doctor 复杂度;语义不变,消费方仅 CliSessionGroup)。
 */

import { useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";
import type { Workspace } from "@kernel/workspace";
import { host } from "@kernel/host";
import type { MenuTarget } from "./LiveSessionRow";
import type { RenameTarget } from "@kernel/RenameInput";
import { deleteDiskSessionFull, deleteLiveSessionFull } from "./sessionOps";
import { setSessionTitle } from "@kernel/sessionTitles";
import { sessionPinKey } from "@kernel/sessionPins";
import { isSessionPinned, pinSession, unpinSession } from "@kernel/sessionPins";

/** 菜单/重命名/删除/扎点接线(自 CliSessionGroup 拆出,react-doctor 复杂度;语义不变)。 */
export function useSessionGroupMenu({
  profile, workspace, sessions, setRescanTick, realTitle,
}: {
  profile: CliProfile;
  workspace: Workspace;
  sessions: CliDiskSession[] | null;
  setRescanTick: (fn: (t: number) => number) => void;
  realTitle: (cliSessionId: string | undefined) => string | undefined;
}) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  /** 重命名提交:null=取消;空串=清除命名回归磁盘标题。 */
  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      setSessionTitle(profile.id, renaming.cliSessionId, value);
    }
    setRenaming(null);
  };

  /** 删除入口:物理删除 + 清命名/置顶覆盖层(语义见 sessionOps);
   *  磁盘删除再触发本地重扫(活删除经 removeSession 的 liveCount 变化自然重扫)。 */
  const deleteLive = (session: SessionMeta) =>
    deleteLiveSessionFull(profile, session, workspace.id, workspace.root, sessions ?? []);
  const deleteDisk = (session: CliDiskSession) =>
    deleteDiskSessionFull(profile, session, workspace.id).then(() =>
      setRescanTick((t) => t + 1),
    );

  const startRename = (cliSessionId: string, current: string) => {
    setRenaming({ profileId: profile.id, cliSessionId, current });
  };

  /**
   * 行内扎点开关:未扎 → 置顶到全局;已扎(任一作用域)→ 取消置顶。
   * 跨作用域迁移仍走右键菜单(codemoss 双作用域语义,开关只做最常用的一键路径)。
   */
  const togglePin = (cliSessionId: string) => {
    const key = sessionPinKey(workspace.id, profile.id, cliSessionId);
    if (isSessionPinned(key)) {
      unpinSession(key);
    } else {
      pinSession(key, "global", realTitle(cliSessionId) ?? cliSessionId);
    }
  };
  /** 菜单目标的磁盘身份:未绑定(活会话未落盘)则不可重命名/置顶。 */
  const menuCliSessionId = menu
    ? menu.kind === "disk"
      ? menu.session.id
      : host.getCliSessionId(menu.session.id)
    : undefined;
  const menuPinKey = menuCliSessionId
    ? sessionPinKey(workspace.id, profile.id, menuCliSessionId)
    : undefined;

  return {
    menu, setMenu, renaming, commitRename, deleteLive, deleteDisk,
    startRename, togglePin, menuCliSessionId, menuPinKey,
  };
}
