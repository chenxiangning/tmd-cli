/**
 * 记忆池只读访问 —— 经 kernel/ipc 的 sqlite_query 原语消费 Magic Context 共享库。
 *
 * 上游实证(PoC 报告 docs/research/magic-context-poc-report.md):
 * - 库:`~/.local/share/cortexkit/magic-context/context.db`(三平台同为
 *   home 相对 POSIX 风格路径;bootstrap 成功后回存 settings,未就绪用默认推断);
 * - `memories.status='active'` 为生效态;FTS5 表 `memories_fts` 支持关键词检索;
 * - `project_path` 存项目身份(git:<root-commit> / dir:<md5[0..12]>)。
 */

import { ipc } from "@kernel/ipc";
import { memoryDbPath } from "./paths";
import {
  CATEGORY_ORDER,
  harnessLabel,
  projectIdentityFromRootCommit,
  type MemoryItem,
  type MemoryPool,
  type MemoryPoolStatus,
} from "./protocol";

async function resolvedDbPath(): Promise<string> {
  // 上游默认解析(paths 统一实取 home)。settings.memoryDbPath 回存(bootstrap
  // 成功后)尚未实现,接 settings 前保持单一事实源,免双路径漂移。
  return memoryDbPath();
}

function rowsToItems(rows: unknown[][]): MemoryItem[] {
  return rows.map((r) => ({
    id: Number(r[0]),
    category: String(r[1] ?? ""),
    content: String(r[2] ?? ""),
    importance: r[3] == null ? null : Number(r[3]),
    status: String(r[4] ?? "active"),
    updatedAt: Number(r[5] ?? 0),
    createdAt: Number(r[6] ?? 0),
    harness: harnessLabel(String(r[7] ?? "") || "pi"),
  }));
}

/** 上游注入优先级排序(CATEGORY_ORDER 升序,未知类目靠后)→ 重要度 → 更新时间。 */
function byPriority(a: MemoryItem, b: MemoryItem): number {
  const oa = CATEGORY_ORDER[a.category] ?? 99;
  const ob = CATEGORY_ORDER[b.category] ?? 99;
  if (oa !== ob) return oa - ob;
  if (a.importance !== b.importance) return (b.importance ?? 0) - (a.importance ?? 0);
  return b.updatedAt - a.updatedAt;
}

/** 列出某项目身份下的生效记忆(可选 FTS 关键词检索)。 */
async function recall(projectIdentity: string, query?: string, limit = 50): Promise<MemoryItem[]> {
  const dbPath = await resolvedDbPath();
  // 宽检索:多词按 OR 组合(FTS porter 词干;单词语义不变)
  const q = query?.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/["'*]/g, "")).filter(Boolean).join(" OR ") || undefined;
  const rows = q
    ? await ipc.sqliteQuery(
        dbPath,
        `SELECT m.id, m.category, m.content, m.importance, m.status, m.updated_at, m.created_at,
                  (SELECT sp.harness FROM session_projects sp WHERE sp.session_id = m.source_session_id LIMIT 1) AS harness
           FROM memories_fts f JOIN memories m ON m.id = f.rowid
          WHERE memories_fts MATCH ?2 AND m.project_path = ?1 AND m.status = 'active'
          ORDER BY rank LIMIT ?3`,
        [projectIdentity, q, String(limit)],
      )
    : await ipc.sqliteQuery(
        dbPath,
        `SELECT id, category, content, importance, status, updated_at, created_at,
                  (SELECT sp.harness FROM session_projects sp WHERE sp.session_id = m.source_session_id LIMIT 1) AS harness
           FROM memories m
          WHERE project_path = ?1 AND status = 'active'
          ORDER BY updated_at DESC LIMIT ?2`,
        [projectIdentity, String(limit)],
      );
  return rowsToItems(rows).sort(byPriority);
}

async function status(): Promise<MemoryPoolStatus> {
  const dbPath = await resolvedDbPath();
  try {
    // 先验文件头:sqlite.rs 是 READ_WRITE 无 CREATE 打开,库文件不存在时
    // open 直接报错走 catch —— 不区分则新装机(库从未落盘)会掉进 locked
    // 分支,重新变成「迁移窗口」误报(2026-09-06 评审 P1)。头 16 字节 =
    // SQLite 魔数;0 字节(迁移半途)同样按未就绪报。
    const head = await ipc.fsReadHead(dbPath, 16).catch(() => "");
    if (!head.startsWith("SQLite format 3")) {
      return { ready: false, count: 0, dbPath: null, reason: "not-installed" };
    }
    // 再验表结构:库存在且可读但未迁移(空库无 memories 表)同为未就绪
    const tables = await ipc.sqliteQuery(
      dbPath,
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='memories'",
      [],
    );
    if (Number(tables[0]?.[0] ?? 0) === 0) {
      return { ready: false, count: 0, dbPath: null, reason: "not-installed" };
    }
    const rows = await ipc.sqliteQuery(
      dbPath,
      "SELECT count(*) FROM memories WHERE status = 'active'",
      [],
    );
    return { ready: true, count: Number(rows[0]?.[0] ?? 0), dbPath };
  } catch {
    /* 打开/查询异常 = 库被占(锁超 3s busy)或读失败,区别于「未安装」 */
    return { ready: false, count: 0, dbPath: null, reason: "locked" };
  }
}

export const memoryPool: MemoryPool = { recall, status };

const identityCache = new Map<string, string | null>();

/** proc_communicate 跑 git rev-list,返回 stdout 文本。 */
async function gitRevListRootCommits(workspaceRoot: string): Promise<string> {
  const result = await ipc.procCommunicate({
    command: "git",
    args: ["-C", workspaceRoot, "rev-list", "--max-parents=0", "HEAD"],
    cwd: workspaceRoot,
    timeoutMs: 10_000,
  });
  return result.stdout;
}

/** 解析 workspace root 的上游项目身份;非 git 工作区返回 null(胶囊显示未纳入)。 */
export async function resolveProjectIdentity(workspaceRoot: string): Promise<string | null> {
  const cached = identityCache.get(workspaceRoot);
  if (cached !== undefined) return cached;
  let identity: string | null = null;
  try {
    const out = await gitRevListRootCommits(workspaceRoot);
    const rootCommit = out
      .split("\n")
      .map((line: string) => line.trim().slice(0, 64))
      .filter((line: string) => /^[0-9a-f]{7,64}$/.test(line))
      .sort()[0];
    identity = rootCommit ? projectIdentityFromRootCommit(rootCommit) : null;
  } catch {
    identity = null;
  }
  identityCache.set(workspaceRoot, identity);
  return identity;
}
