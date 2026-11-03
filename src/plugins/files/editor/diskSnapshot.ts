import { ipc } from "@kernel/ipc";
import { findRemoteFileSourceForUri, isRemoteFileUri, type RemoteFileVersion } from "@kernel/fileSources";

export interface DiskSnapshot {
  raw: string;
  mtimeMs: number | null;
  version?: RemoteFileVersion;
}

/** 重读正文与版本;WSL 由同一远程脚本返回,本地用读前/后 mtime 关闭配对漂移窗。 */
export async function readDiskSnapshot(path: string): Promise<DiskSnapshot> {
  if (isRemoteFileUri(path)) {
    const source = findRemoteFileSourceForUri(path);
    if (!source) throw new Error("远程文件来源不可用");
    const result = await source.readText(path, 512 * 1024);
    return typeof result === "string"
      ? { raw: result, mtimeMs: null }
      : { raw: result.content, mtimeMs: null, version: result.version };
  }
  let raw = "";
  let after: number | null = null;
  for (let i = 0; i < 2; i++) {
    const before = await ipc.fsMtime(path).catch(() => null);
    raw = await ipc.fsReadFile(path);
    after = await ipc.fsMtime(path).catch(() => null);
    if (before === null || after === null || before === after) break;
  }
  return { raw, mtimeMs: after };
}
