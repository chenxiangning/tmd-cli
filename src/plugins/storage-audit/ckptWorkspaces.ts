/**
 * checkpoints 按工作区盘点(清理面数据源,纯装配:路径/存在性/占用批量查)。
 * 快照目录定位与 Rust store::ws_dir 同式:~/.tmd-cli/checkpoints/<md5(cwd)>;
 * md5 经现成 md5_hex 命令(与后端同源,不引前端哈希实现)。
 */

import { ipc } from "@kernel/ipc";
import { getWorkspaces, type Workspace } from "@kernel/workspace";

export interface CkptWorkspaceRow {
  workspace: Workspace;
  /** 快照目录绝对路径(体检与清理后的刷新共用)。 */
  dir: string;
  bytes: number;
  files: number;
}

/** 列出有快照目录的工作区(不存在快照 = 不出行);占用一批 fsDirUsage 合查。 */
export async function listCkptWorkspaces(): Promise<CkptWorkspaceRow[]> {
  const configDir = await ipc.configDir();
  const candidates = await Promise.all(
    getWorkspaces().map(async (workspace) => {
      const hash = await ipc.md5Hex(workspace.root);
      const dir = `${configDir}/checkpoints/${hash}`;
      const exists = await ipc.fsListDir(dir).then(
        () => true,
        () => false,
      );
      return exists ? { workspace, dir } : null;
    }),
  );
  const hits = candidates.filter((c) => c !== null);
  if (hits.length === 0) return [];
  const reports = await ipc.fsDirUsage(
    hits.map((h) => ({ label: h.workspace.id, path: h.dir, skipDirNames: [] })),
  );
  const byId: Record<string, { bytes: number; files: number }> = {};
  for (const r of reports) byId[r.label] = { bytes: r.bytes, files: r.files };
  return hits.map((h) => ({
    workspace: h.workspace,
    dir: h.dir,
    bytes: byId[h.workspace.id]?.bytes ?? 0,
    files: byId[h.workspace.id]?.files ?? 0,
  }));
}
