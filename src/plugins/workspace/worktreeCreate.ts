/**
 * worktree 会话创建编排(自 WorktreeSessionDialog 拆出:组件函数复杂度铁则
 * 与 300 行铁则)。里程碑旗标决定回滚面:worktreeAdd 成功后才存在可回滚的树;
 * spawn 成功后不回滚(活会话在树上),只差关联记录如实报告。
 */

import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { addWorkspace, removeWorkspace } from "@kernel/workspace";
import { recordWtSession } from "./worktreeSession";

/** 创建链结果:ok = 全链成功;失败按里程碑分类(组件侧映射文案)。 */
export type WtCreateOutcome =
  | { ok: true }
  | { ok: false; kind: "spawned-no-record" | "add-failed" | "rolled-back" | "residue"; msg: string };

/** 回滚残留树 + 对称摘工作区(spawn 失败路径专用);返回是否回滚成功。 */
async function rollbackWorktree(repoCwd: string, wtPath: string, wsId: string | null): Promise<boolean> {
  try {
    await ipc.gitWorktreeRemove(repoCwd, wtPath, true);
    if (wsId) removeWorkspace(wsId); /* 对称清理:不留指向已删目录的悬空工作区。 */
    return true;
  } catch {
    return false; /* 回滚失败也如实告知入口。 */
  }
}

/** 失败里程碑 → 用户文案(t 在此统一映射,组件零分支)。 */
export function wtCreateOutcomeMessage(r: Extract<WtCreateOutcome, { ok: false }>): string {
  if (r.kind === "spawned-no-record") return t("会话已启动,但未记录 worktree 关联:{msg}", { msg: r.msg });
  if (r.kind === "add-failed") return t("创建失败:{msg}", { msg: r.msg });
  if (r.kind === "rolled-back") return t("创建失败,已回滚:{msg}", { msg: r.msg });
  return t("创建失败:{msg}(可重试;残留树可在 git 面板 worktree 管理中移除)", { msg: r.msg });
}

/** 建树 → node_modules 复用 → addWorkspace → spawn 全链;任一步失败按里程碑返回。 */
export async function runWorktreeCreate(input: {
  repoCwd: string;
  wtPath: string;
  finalBranch: string;
  newBranch: boolean;
  engineId: string;
  title: string;
}): Promise<WtCreateOutcome> {
  let wsId: string | null = null;
  let added = false;
  let spawnedId: string | null = null;
  try {
    await ipc.gitWorktreeAdd(input.repoCwd, input.wtPath, input.finalBranch, input.newBranch);
    added = true;
    /* 主仓有 node_modules → 符号链接复用。失败不阻断(依赖可后补装),
     * 吞掉保后续 spawn 与映射落盘。 */
    const nm = `${input.repoCwd.replace(/[\\/]+$/, "")}/node_modules`;
    try {
      await ipc.fsListDir(nm).then(
        () => ipc.fsSymlinkDir(nm, `${input.wtPath}/node_modules`),
        () => undefined,
      );
    } catch {
      console.warn("[wt-session] node_modules 符号链接失败(不阻断)", input.wtPath);
    }
    /* worktree = 独立工作区(WorktreeManageDialog 同款 addWorkspace),会话在新工作区起。 */
    const ws = addWorkspace(input.wtPath);
    wsId = ws.id;
    const spawned = await host.spawnRawSession(
      input.engineId,
      {
        command: host.getCliProfile(input.engineId)?.command ?? "",
        args: host.getCliProfile(input.engineId)?.args ?? [],
        cwd: input.wtPath,
        title: input.title,
      },
      ws.id,
      { activate: true, identityTrack: true },
    );
    spawnedId = spawned.id;
    recordWtSession(spawned.id, { branch: input.finalBranch, wtPath: input.wtPath, root: input.repoCwd });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (spawnedId !== null) return { ok: false, kind: "spawned-no-record", msg };
    if (!added) return { ok: false, kind: "add-failed", msg };
    const rolledBack = await rollbackWorktree(input.repoCwd, input.wtPath, wsId);
    return { ok: false, kind: rolledBack ? "rolled-back" : "residue", msg };
  }
}
