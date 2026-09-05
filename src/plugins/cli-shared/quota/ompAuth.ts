/**
 * omp agent.db 凭据读取 —— omp CLI 私有库知识(~/.omp/agent/agent.db,
 * auth_credentials 表)集中地。
 *
 * 消费者:cli-omp(quota provider)+ welcome(引擎卡已登录供应商盘点),
 * 满足 cli-shared 准入(≥2 插件消费同一 CLI 磁盘格式)。
 * 经 kernel 的通用只读 sqlite 原语(ipc.sqliteQuery)代读,内核不理解本格式。
 */

import { ipc } from "@kernel/ipc";

/** omp 凭据库相对家目录路径。 */
const OMP_AGENT_DB = ".omp/agent/agent.db";

async function ompDbPath(): Promise<string> {
  const home = await ipc.configHomeDir();
  return `${home.replace(/\/$/, "")}/${OMP_AGENT_DB}`;
}

function cellText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 列出已登录且未禁用的供应商 id(auth_credentials 表,按 id 升序)。
 *  库不存在/查询失败 = 空表,不抛错。 */
export async function listOmpAuthProviders(): Promise<string[]> {
  const rows = await ipc
    .sqliteQuery(
      await ompDbPath(),
      "SELECT DISTINCT provider FROM auth_credentials \
       WHERE disabled_cause IS NULL ORDER BY provider",
      [],
    )
    .catch(() => [] as unknown[][]);
  return rows
    .map((row) => cellText(row[0]))
    .filter((v): v is string => v !== null);
}

/** 读某供应商最新一条凭据的 data JSON(按 updated_at 取新,仅未禁用)。
 *  无记录 = null,不抛错。 */
export async function readOmpAuthCredential(
  provider: string,
): Promise<string | null> {
  const rows = await ipc
    .sqliteQuery(
      await ompDbPath(),
      "SELECT data FROM auth_credentials \
       WHERE provider = ?1 AND disabled_cause IS NULL \
       ORDER BY updated_at DESC LIMIT 1",
      [provider],
    )
    .catch(() => [] as unknown[][]);
  return rows[0] ? cellText(rows[0][0]) : null;
}
