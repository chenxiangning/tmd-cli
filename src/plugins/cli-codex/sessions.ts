/**
 * codex 磁盘会话扫描 —— 自 index.tsx 拆出(叶子模块,移动端 home 历史直用)。
 * 布局:~/.codex/sessions/<date>/rollout-*.jsonl,不按 cwd 分目录,
 * meta 行自证归属;resume/fork 同 id 多文件取 mtime 最新。
 */

import { ipc } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import { pathsEqual } from "@kernel/pathUtils";
import type { CliDiskSession } from "@kernel/cli";
import { readHeadTitle } from "../cli-shared/diskSessions";
import { HEAD_BYTES, extractMeta } from "./sessionStatus";

const CASE_INSENSITIVE_FS = getPlatformKind() !== "linux";

const SCAN_LIMIT = 200;

const RESULT_LIMIT = 200; // 与 SCAN_LIMIT 对齐:展示层分页(10/20/40/80),扫描不必再卡小上限

export async function listCodexSessions(cwd: string): Promise<CliDiskSession[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  /* 读头并发一次发出(collect 已按 mtime 倒序,顺序保持 = 先见即最新;
     手机 relay 场景串行 200 次 RTT 不可接受)。 */
  const candidates = rollouts.slice(0, SCAN_LIMIT);
  const heads = await Promise.all(
    candidates.map((f) => ipc.fsReadHead(f.path, HEAD_BYTES).catch(() => "")),
  );
  const sessions: CliDiskSession[] = [];
  for (let i = 0; i < candidates.length && sessions.length < RESULT_LIMIT; i++) {
    const meta = heads[i] ? extractMeta(heads[i]) : null;
    if (!meta || !pathsEqual(meta.cwd, cwd, CASE_INSENSITIVE_FS)) continue;
    // codex resume/fork 会在新日期目录写同 id 的新 rollout 文件:
    // 按 id 去重,保留最新 mtime(collect 已倒序,先见即最新)
    if (sessions.some((s) => s.id === meta.id)) continue;
    sessions.push({
      id: meta.id,
      modifiedAt: candidates[i].modifiedAt,
      createdAt: meta.createdAt,
      path: candidates[i].path,
      title: "",
    });
  }
  // codex 无 title 概念:标题 = 首条 role:user 的 response_item 文本,走共享两段式读头
  // (meta 行带完整 system prompt 可达数十 KB,深窗覆盖;4KB meta 窗照旧先筛,成本可控)。
  return Promise.all(
    sessions.map(async (s) => ({ ...s, title: await readHeadTitle(s.path) })),
  );
}
