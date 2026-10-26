/**
 * 远程工作区 Git 状态(项 12 只读子集)—— SSH 远程 WSL 工作区的 git2 内核
 * 原语够不着,退化为 wslExec 跑 `git status --porcelain=v1 -b` 文本解析:
 * branch/ahead/behind + 脏文件列表(只读);log/diff 视图维持降级提示。
 * porcelain 格式知识归本插件(内核零 CLI 私有格式契约)。
 */

import { useCallback, useEffect, useState } from "react";
import { ipc, type SshHostConfig } from "@kernel/ipc";
import { errTextDisplay } from "@kernel/errText";
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
  /* 回退前先认「空仓无提交」与「HEAD 分离」两形态(0.4.6 复审 P1:旧回退
   * split(/[\s.]/) 会把 "No commits yet" 解析出分支 "No")。 */
  const noCommit = head.match(/^## No commits yet on (\S+)/);
  const detached = head === "## HEAD (no branch)";
  const fallback = detached ? "HEAD (no branch)" : (m?.[1] ?? head.slice(3).split(/[\s.]/)[0]);
  const branch = noCommit?.[1] ?? fallback ?? "?";
  const upstream = m?.[2] ?? null;
  const ab = m?.[3] ?? "";
  const ahead = Number(ab.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(ab.match(/behind (\d+)/)?.[1] ?? 0);
  /* 条目行形态过滤 `XY path`(XY ∈ 空格/M/A/D/R/C/U/?/!):`2>&1 || true` 混入
   * 的 warning/stderr 噪音行不合形态即丢弃;quotepath 关闭后仍可能带引号的
   * rename 行剥外层引号。 */
  const entries = lines
    .filter((l) => /^[ MADRCU?!]{2} /.test(l))
    .map((l) => {
      const path = l.slice(3);
      return {
        xy: l.slice(0, 2),
        path: path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path,
      };
    });
  return { branch, upstream, ahead, behind, entries };
}

/** wslExec 输出是否为远端执行错误(而非「不是 git 仓库」):解析不出 ## 头
 * 且含 fatal:/command not found(远端未装 git、ssh 不通)时报原始错误。 */
export function isRemoteGitExecError(out: string): boolean {
  return !/^## /m.test(out) && /fatal:|command not found/.test(out);
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
        `git -c core.quotepath=false -C "${linuxRoot}" status --porcelain=v1 -b 2>&1 || true`,
        host,
      );
      const parsed = parseRemoteStatus(out);
      if (parsed) {
        setStatus(parsed);
        setError(null);
      } else if (isRemoteGitExecError(out)) {
        /* 远端执行失败(未装 git/ssh 不通)不得误诊为「不是 git 仓库」。 */
        setStatus(null);
        setError(out.trim().slice(0, 200));
      } else {
        setStatus(null);
        setError("not-a-repo");
      }
    } catch (e) {
      setStatus(null);
      setError(errTextDisplay(e));
    } finally {
      setLoading(false);
    }
  }, [ws, root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, error, loading, refresh };
}
