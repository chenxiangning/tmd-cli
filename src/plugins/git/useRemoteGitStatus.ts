/**
 * 远程工作区 Git 状态(项 12 只读子集)—— SSH 远程 WSL 工作区的 git2 内核
 * 原语够不着,退化为 wslExec 跑 `git status --porcelain=v1 -b` 文本解析:
 * branch/ahead/behind + 脏文件列表(只读);log/diff 视图维持降级提示。
 * porcelain 格式知识归本插件(内核零 CLI 私有格式契约)。
 */

import { useCallback, useEffect, useState } from "react";
import { ipc, type SshHostConfig } from "@kernel/ipc";
import { getSettingsState } from "@kernel/settings";
import type { Workspace } from "@kernel/workspace";

/** porcelain 解析结果(纯数据;解析器为纯函数,单测直调)。 */
export interface RemoteGitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 脏文件(工作区+暂存);renames 两侧各一行,如实展示。 */
  entries: { xy: string; path: string }[];
}

/** 解析 `git status --porcelain=v1 -b` 输出;空输出 = 非 git 仓库(null)。 */
export function parseRemoteStatus(out: string): RemoteGitStatus | null {
  const lines = out.split("\n").filter((l) => l.length > 0);
  const head = lines.find((l) => l.startsWith("## "));
  if (!head) return null;
  /* 形态:## main...origin/main [ahead 1, behind 2] / ## No commits yet on main / ## HEAD (no branch) */
  const m = head.match(/^## (?:Initial commit on )?(\S+?)(?:\.\.\.(\S+?))?(?: \[(.*?)\])?$/);
  const branch = (m?.[1] ?? head.slice(3).split(/[\s.]/)[0]) || "?";
  const upstream = m?.[2] ?? null;
  const ab = m?.[3] ?? "";
  const ahead = Number(ab.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(ab.match(/behind (\d+)/)?.[1] ?? 0);
  const entries = lines
    .filter((l) => !l.startsWith("## ") && !l.startsWith("# "))
    .map((l) => ({ xy: l.slice(0, 2), path: l.slice(3) }));
  return { branch, upstream, ahead, behind, entries };
}

function hostOf(ws: Workspace): SshHostConfig | null {
  const id = ws.wsl?.hostId;
  return id ? getSettingsState().settings.ssh.hosts.find((h) => h.id === id) ?? null : null;
}

/** 拉一次远程 status;distro/host/root 任一缺失 = 无远程能力(null 静默)。 */
export function useRemoteGitStatus(ws: Workspace | null | undefined, root: string | null) {
  const [status, setStatus] = useState<RemoteGitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const distro = ws?.wsl?.distro;
    const host = ws ? hostOf(ws) : null;
    const linuxRoot = ws?.wsl ? root : null;
    if (!ws?.wsl?.hostId || !distro || !host || !linuxRoot) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const out = await ipc.wslExec(
        distro,
        `git -C "${linuxRoot}" status --porcelain=v1 -b 2>&1 || true`,
        host,
      );
      const parsed = parseRemoteStatus(out);
      setStatus(parsed);
      setError(parsed ? null : "not-a-repo");
    } catch (e) {
      setStatus(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [ws, root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, error, loading, refresh };
}
