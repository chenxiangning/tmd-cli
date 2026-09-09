/**
 * 配置读写壳 —— 读分三态:ok / missing(ENOENT,空态可首次创建)/
 * error(存在但不可读,阻断编辑防覆写)。写盘前每文件本会话首次创建
 * `.bak-tmd` 备份(仅对读成功的文件;对齐 omp 自身 .bak-pre-* 先例)。
 * 备份只建一次:同会话反复保存不滚存,首份永远是最初原样。
 */

import { ipc } from "@kernel/ipc";

export type ConfigRead =
  | { kind: "ok"; text: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const backedUp = new Set<string>();

/** 仅供测试复位备份水位。 */
export function resetBackupsForTest(): void {
  backedUp.clear();
}

/** 读失败时用父目录清单区分「文件不存在」与「存在但不可读」。 */
export async function readConfig(path: string): Promise<ConfigRead> {
  try {
    return { kind: "ok", text: await ipc.fsReadFile(path) };
  } catch (e) {
    const cut = path.lastIndexOf("/");
    const dir = path.slice(0, cut);
    const base = path.slice(cut + 1);
    try {
      const entries = await ipc.fsCollectFiles(dir, "");
      return entries.some((f) => f.name === base)
        ? { kind: "error", message: e instanceof Error ? e.message : String(e) }
        : { kind: "missing" };
    } catch {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}

async function readOriginal(path: string): Promise<string | null> {
  const r = await readConfig(path);
  return r.kind === "ok" ? r.text : null;
}

export async function writeConfigFile(path: string, content: string): Promise<void> {
  if (!backedUp.has(path)) {
    backedUp.add(path);
    const original = await readOriginal(path);
    if (original !== null) {
      // 备份失败不阻塞保存(用户明确要求写盘);极端只读盘场景降级为无备份。
      await ipc.fsWriteFile(`${path}.bak-tmd`, original).catch(() => backedUp.delete(path));
    }
  }
  await ipc.fsWriteFile(path, content);
}
