/**
 * omp 供应商认证 IO —— agent.db auth_credentials 表的读快照与 API Key 写入。
 *
 * 语义对齐 omp 自身(codemoss pi_family_auth.rs 同款 SQL):
 * - 读:`SELECT provider, credential_type, data WHERE disabled_cause IS NULL`;
 *   api_key 行取 data JSON 的 key;oauth 行只读(刷新由 omp 自己的 auth-broker 管)。
 * - 写 key:校验 → DELETE 同 provider 的 api_key 行 → INSERT(单条参数化,走
 *   内核通用原语 sqliteExecute,SQL 留本插件)。
 * - 删:api_key 行可删;仅剩 oauth 行 = omp 自管,提示用 `omp auth-broker logout`。
 */

import { ipc } from "@kernel/ipc";
import { OMP_APIKEY_PROVIDERS, type OmpApiKeyProvider } from "./providerAuthCatalog";

/** 单个 API Key 供应商的展示快照。 */
export interface OmpAuthSnapshot {
  id: string;
  name: string;
  icon: string | null;
  envVar: string;
  featured: boolean;
  /** "configured" = 凭据表有 api_key 行;"none" = 未配置。 */
  state: "configured" | "none";
  /** 掩码后的 key(头 6 + ········ + 尾 4);未配置 = null。 */
  maskedKey: string | null;
  keySource: "literal" | "command" | "envRef" | null;
}

export interface OmpAuthList {
  dbPath: string;
  providers: OmpAuthSnapshot[];
  /** 凭据表里有 oauth 行的 provider id(订阅授权区判「已授权」用)。 */
  oauthActive: Set<string>;
  /** oauth data 带 refresh 字段的 provider id(「已授权 · 自动刷新」用)。 */
  oauthRefresh: Set<string>;
}

/** agent.db 路径。 */
export async function ompAuthDbPath(): Promise<string> {
  const home = await ipc.configHomeDir();
  return `${home}/.omp/agent/agent.db`;
}

/** 掩码:头 6 + ········ + 尾 4;≤10 字符全掩;!/$ 前缀(命令/环境变量引用)非密文原样返回。 */
export function maskKey(key: string): string {
  if (key.startsWith("!") || key.startsWith("$")) return key;
  if (key.length > 10) return `${key.slice(0, 6)}········${key.slice(-4)}`;
  return "········";
}

function keySource(key: string): OmpAuthSnapshot["keySource"] {
  if (key.startsWith("!")) return "command";
  if (key.startsWith("$")) return "envRef";
  return "literal";
}

/** 写入前校验:非空、无换行(目录外 id——如 omp 计划供应商——同样允许,凭据表本就开放)。
 *  返回 trim 后的 key。 */
export function validateApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API Key 不能为空");
  if (/[\r\n]/.test(trimmed)) throw new Error("API Key 不能包含换行");
  return trimmed;
}

/** 凭据行 (provider, credential_type, data) → key 映射 + oauth 集合(纯函数,可测)。 */
export function buildAuthIndex(rows: Array<[string, string, string]>): {
  keys: Map<string, string>;
  oauthActive: Set<string>;
  oauthRefresh: Set<string>;
} {
  const keys = new Map<string, string>();
  const oauthActive = new Set<string>();
  const oauthRefresh = new Set<string>();
  for (const [provider, type, data] of rows) {
    try {
      const v: unknown = JSON.parse(data);
      if (
        type === "api_key" &&
        v &&
        typeof v === "object" &&
        typeof (v as Record<string, unknown>).key === "string"
      ) {
        if (!keys.has(provider)) keys.set(provider, (v as Record<string, string>).key);
      } else if (type === "oauth" && v && typeof v === "object") {
        oauthActive.add(provider);
        if (typeof (v as Record<string, unknown>).refresh === "string" && (v as Record<string, string>).refresh)
          oauthRefresh.add(provider);
      }
    } catch {
      /* 坏 data 行跳过,不阻断整批 */
    }
  }
  return { keys, oauthActive, oauthRefresh };
}

function snapshotsFor(keys: Map<string, string>): OmpAuthSnapshot[] {
  const byId = new Map(OMP_APIKEY_PROVIDERS.map((p) => [p.id, p]));
  const rows: OmpAuthSnapshot[] = OMP_APIKEY_PROVIDERS.map((p: OmpApiKeyProvider) => {
    const key = keys.get(p.id);
    return {
      id: p.id,
      name: p.name,
      icon: p.icon,
      envVar: p.envVar,
      featured: p.featured,
      state: key !== undefined ? ("configured" as const) : ("none" as const),
      maskedKey: key !== undefined ? maskKey(key) : null,
      keySource: key !== undefined ? keySource(key) : null,
    };
  });
  // 目录外但有存储凭据的 provider(omp 计划供应商,如 minimax-code-cn / zhipu-coding-plan)
  // 自动补行,保证「auth N」计数与面板可见行一致;无 env 映射,置顶展示。
  const extras: OmpAuthSnapshot[] = [];
  for (const [id, key] of keys) {
    if (byId.has(id)) continue;
    extras.push({
      id,
      name: id,
      icon: null,
      envVar: "",
      featured: true,
      state: "configured",
      maskedKey: maskKey(key),
      keySource: keySource(key),
    });
  }
  return [...extras, ...rows];
}

/** 读快照:库缺失 = 全目录未配置(sqlite_query 对缺失库返回空集);
 *  表缺失(omp 未首跑)= 友好提示;其余读错误抛错到 UI。 */
export async function listOmpAuth(): Promise<OmpAuthList> {
  const dbPath = await ompAuthDbPath();
  let rows: Array<[string, string, string]>;
  try {
    rows = (await ipc.sqliteQuery(
      dbPath,
      "SELECT provider, credential_type, data FROM auth_credentials WHERE disabled_cause IS NULL",
      [],
    )) as Array<[string, string, string]>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table/i.test(msg))
      throw new Error("agent.db 还没有 auth_credentials 表(先运行一次 omp 完成初始化)");
    throw e;
  }
  const { keys, oauthActive, oauthRefresh } = buildAuthIndex(rows);
  return { dbPath, providers: snapshotsFor(keys), oauthActive, oauthRefresh };
}

/** 写/替换某供应商的 api_key 凭据(DELETE + INSERT 两条,语义同 omp 替换)。 */
export async function setOmpApiKey(providerId: string, key: string): Promise<void> {
  const trimmed = validateApiKey(key);
  const dbPath = await ompAuthDbPath();
  const data = JSON.stringify({ key: trimmed });
  await ipc.sqliteExecute(
    dbPath,
    "DELETE FROM auth_credentials WHERE provider = ?1 AND credential_type = 'api_key'",
    [providerId],
  );
  await ipc.sqliteExecute(
    dbPath,
    "INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES (?1, 'api_key', ?2, NULL)",
    [providerId, data],
  );
}

/** 删除 api_key 凭据;仅剩 oauth 行 = omp 自管,报错指引 logout。 */
export async function deleteOmpCredential(providerId: string): Promise<void> {
  const dbPath = await ompAuthDbPath();
  let rows: Array<[string, string, string]>;
  try {
    rows = (await ipc.sqliteQuery(
      dbPath,
      "SELECT provider, credential_type, data FROM auth_credentials WHERE disabled_cause IS NULL",
      [],
    )) as Array<[string, string, string]>;
  } catch {
    return; // 库/表不存在 = 无可删
  }
  const mine = rows.filter(([p, t]) => p === providerId && t === "api_key");
  if (mine.length === 0) {
    const oauth = rows.some(([p, t]) => p === providerId && t === "oauth");
    if (oauth)
      throw new Error(
        `${providerId} 是 OAuth 凭据,由 omp 自管;请在终端执行 omp auth-broker logout ${providerId}`,
      );
    return;
  }
  await ipc.sqliteExecute(
    dbPath,
    "DELETE FROM auth_credentials WHERE provider = ?1 AND credential_type = 'api_key'",
    [providerId],
  );
}
