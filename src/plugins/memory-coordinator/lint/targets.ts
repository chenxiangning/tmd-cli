/**
 * 体检目标推导 —— 声明式,零路径知识。
 *
 * 数据源与 memory-files 面板同一份:各 cli-* profile 注册时声明的
 * memoryFiles(project 拼工作区 cwd / user 拼用户 home)。tmd-lint 消费时按
 * absPath 去重(pi/kimi/codex/qoder/opencode 共用一份项目 AGENTS.md 是常态,
 * 体检对象是「文件」不是「引擎槽」)。存在性探活走 fsReadHeads 一次批量 IPC
 * (返回按下标对齐,单文件失败 = 空串 = 缺)。
 */

import { ipc } from "@kernel/ipc";
import type { LintTarget } from "./lintTypes";

/** CliProfile 的最小切片(host.getCliProfiles() 返回面,测试可喂纯对象)。 */
export interface MemoryProfileSource {
  id: string;
  memoryFiles?: { scope: "project" | "user"; label: string; relPath: string }[];
}

/** 声明槽 → 唯一文件目标(保序:先声明先上;exists 先置 true 由探活修正)。 */
export function expandLintTargets(
  profiles: MemoryProfileSource[],
  cwd: string | null,
  home: string,
): LintTarget[] {
  const byPath = new Map<string, LintTarget>();
  for (const p of profiles) {
    for (const mf of p.memoryFiles ?? []) {
      const base = mf.scope === "project" ? cwd : home || null;
      if (!base) continue; /* 无 cwd 项目级整组不出(与 memory-files 面板同口径) */
      const absPath = `${base}/${mf.relPath}`;
      const hit = byPath.get(absPath);
      if (hit) {
        if (!hit.engines.includes(p.id)) hit.engines.push(p.id);
      } else {
        byPath.set(absPath, { absPath, scope: mf.scope, engines: [p.id], exists: true });
      }
    }
  }
  return [...byPath.values()];
}

/** 批量探活:头部可读非空 = 在(空目录文件首字节为空也判缺,与面板同口径)。 */
export async function probeTargets(paths: string[]): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  const heads = await ipc.fsReadHeads(paths, 1);
  const out: Record<string, boolean> = {};
  paths.forEach((p, i) => {
    out[p] = (heads[i] ?? "") !== "";
  });
  return out;
}
