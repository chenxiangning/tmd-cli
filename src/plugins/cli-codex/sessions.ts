/**
 * codex 磁盘会话扫描 —— 自 index.tsx 拆出(叶子模块,移动端 home 历史直用)。
 * 布局:~/.codex/sessions/<date>/rollout-*.jsonl,不按 cwd 分目录,
 * meta 行自证归属;resume/fork 同 id 多文件取 mtime 最新。
 */

import { ipc } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import { pathsEqual } from "@kernel/pathUtils";
import type { CliDiskSession } from "@kernel/cli";
import { readHeadMetasBatch, readHeadsBatched } from "../cli-shared/sessionHead";
import { HEAD_BYTES, extractMeta } from "./sessionStatus";

const CASE_INSENSITIVE_FS = getPlatformKind() !== "linux";

const SCAN_LIMIT = 200;

const RESULT_LIMIT = 200; // 与 SCAN_LIMIT 对齐:展示层分页(10/20/40/80),扫描不必再卡小上限

/** meta 读头缓存:rollout 头部 meta 行落盘后不再变化(append-only),mtime 未变即
 *  复用解析产物,重扫收敛为 1 次 fs_collect_files + 仅新/变文件读头(语义同
 *  cli-shared headCache;meta 行型 codex 私有,留本插件)。池按 path 全局共享,
 *  W 工作区并发扫同一目录的重复读头直接消失。上限防目录无限增长泄漏。 */
type CodexMeta = ReturnType<typeof extractMeta>;
const META_CACHE_MAX = 8192;
const metaCache = new Map<string, { mtime: number; meta: CodexMeta }>();

export async function listCodexSessions(cwd: string): Promise<CliDiskSession[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  /* 缓存剪除:collect 已消失的文件条目丢弃(同 scanJsonlSessions)。 */
  const live = new Set(rollouts.map((f) => f.path));
  for (const p of [...metaCache.keys()]) {
    if (!live.has(p)) metaCache.delete(p);
  }
  /* 读头批量(mtime 未变走缓存):外网中继逐文件并发读头会撞桥并发帽(快拒→
     会话缺列)+ 灌爆链路;批量 + 缓存把重扫收敛为 1 次 fs_collect_files + 仅
     新/变文件。collect 已按 mtime 倒序,顺序保持 = 先见即最新。 */
  const candidates = rollouts.slice(0, SCAN_LIMIT);
  const misses = candidates.filter((f) => metaCache.get(f.path)?.mtime !== f.modifiedAt);
  const heads = misses.length
    ? await readHeadsBatched(misses.map((f) => f.path), HEAD_BYTES)
    : [];
  const headOf = new Map(misses.map((f, i) => [f.path, heads[i]]));
  const metas = candidates.map((f) => {
    const cached = metaCache.get(f.path);
    if (cached && cached.mtime === f.modifiedAt) return cached.meta;
    const head = headOf.get(f.path) ?? "";
    const meta = head ? extractMeta(head) : null;
    if (meta) {
      if (metaCache.size >= META_CACHE_MAX) {
        const oldest = metaCache.keys().next().value;
        if (oldest !== undefined) metaCache.delete(oldest);
      }
      metaCache.set(f.path, { mtime: f.modifiedAt, meta });
    } else {
      metaCache.delete(f.path);
    }
    return meta;
  });
  const sessions: CliDiskSession[] = [];
  for (let i = 0; i < candidates.length && sessions.length < RESULT_LIMIT; i++) {
    const meta = metas[i];
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
  // codex 无 title 概念:标题 = 首条 role:user 的 response_item 文本,走共享批量
  // 两段式读头(sessionHead.readHeadMetasBatch;meta 行带完整 system prompt 可达
  // 数十 KB,深窗覆盖)。标题同走 mtime 缓存(共享 headCache 池),重扫只读新/变文件。
  const titleMetas = await readHeadMetasBatch(sessions);
  return sessions.map((s, i) => ({ ...s, title: titleMetas[i].title ?? "" }));
}
