/**
 * .bak-tmd 备份壳 —— 与 cli-config/io.ts 同纪律:每路径每会话只备份一次,
 * 备份失败不阻塞写盘(降级为无备份)。消费方:channelDoc 存储 + claude/codex
 * 两个 channelApply(≥2,满足 cli-shared 准入)。
 */

import { ipc } from "@kernel/ipc";

const backedUp = new Set<string>();

/** 仅供测试复位备份水位。 */
export function resetBackupsForTest(): void {
  backedUp.clear();
}

/** 写盘前备份原文件(存在且未备份过才写),返回备份路径;无原文件 = null。 */
export async function backupOnce(path: string): Promise<string | null> {
  const bak = `${path}.bak-tmd`;
  if (backedUp.has(path)) return bak;
  try {
    const original = await ipc.fsReadFile(path);
    await ipc.fsWriteFile(bak, original);
    backedUp.add(path);
    return bak;
  } catch {
    return null; // 原文件不存在或不可读:无可备份
  }
}

/** 从 .bak-tmd 恢复(codex apply 多段写盘失败回滚用);无备份 = no-op,不掩盖主错误。 */
export async function restoreFromBackup(path: string): Promise<void> {
  try {
    const text = await ipc.fsReadFile(`${path}.bak-tmd`);
    await ipc.fsWriteFile(path, text);
  } catch {
    /* 无备份 */
  }
}
