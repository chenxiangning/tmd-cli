/**
 * cc-switch 导入解析 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 双源:
 *   1. v3 SQLite `~/.cc-switch/cc-switch.db` 的 `providers` 表(经 tmd 已有
 *      `ipc.sqliteQuery` 只读原语读);
 *   2. v2 legacy `~/.cc-switch/config.json` 的 `apps.<app>.providers`(对象 map 或数组都支持)。
 *
 * 归一:把每条 cc-switch 条目转成 tmd Channel;`source="cc-switch"` + `ccsId=<原 id>`
 * 作为后续去重键。摊平 baseUrl / apiKey / model 走各引擎惯例(env 键名或 base_url 字段)。
 *
 * 本文件只承载解析与归一的纯函数;sqliteQuery / fsReadFile 调用由调用方(ProviderChannelsCard)
 * 提供,保证解析纯函数可单测。
 */
import type { Channel, SupportedEngineId } from "./types";
import { ipc } from "@kernel/ipc";

export interface CcSwitchDbRow {
  id: string;
  name: string;
  /** 字符串列,内含 settingsConfig JSON。解析失败视为空对象(不阻断整批)。 */
  settingsConfig: string;
  /** v3 db `app_type` 列(codemoss ccs_app_key:claude/codex/grokbuild);缺省走启发式。 */
  appType?: string;
}
export interface CcSwitchRawEntry {
  id: string;
  name: string;
  settingsConfig: Record<string, unknown>;
}

/** v2 JSON 中 `apps.<app>.providers` 可能是 object map 或 array;输出统一的 [(id, rawEntry)]。 */
export function parseCcSwitchJson(text: string): Map<SupportedEngineId, CcSwitchRawEntry[]> {
  const out = new Map<SupportedEngineId, CcSwitchRawEntry[]>();
  const trimmed = text.trim();
  if (!trimmed) return out;
  const v: unknown = JSON.parse(trimmed);
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const apps = (v as Record<string, unknown>).apps;
  if (!apps || typeof apps !== "object" || Array.isArray(apps)) return out;
  const engines: SupportedEngineId[] = ["claude", "codex"];
  for (const engine of engines) {
    const app = (apps as Record<string, unknown>)[engine];
    if (!app || typeof app !== "object" || Array.isArray(app)) continue;
    const providersRaw = (app as Record<string, unknown>).providers;
    const list: CcSwitchRawEntry[] = [];
    if (providersRaw && typeof providersRaw === "object" && !Array.isArray(providersRaw)) {
      for (const [id, pv] of Object.entries(providersRaw as Record<string, unknown>)) {
        list.push(coerceRawEntry(id, pv));
      }
    } else if (Array.isArray(providersRaw)) {
      for (const pv of providersRaw) {
        if (!pv || typeof pv !== "object" || Array.isArray(pv)) continue;
        const id = typeof (pv as Record<string, unknown>).id === "string"
          ? ((pv as Record<string, unknown>).id as string)
          : "";
        if (!id) continue;
        list.push(coerceRawEntry(id, pv));
      }
    }
    if (list.length) out.set(engine, list);
  }
  return out;
}

function coerceRawEntry(id: string, raw: unknown): CcSwitchRawEntry {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = typeof obj.name === "string" ? obj.name : id;
  const settingsConfigRaw = obj.settingsConfig;
  let settingsConfig: Record<string, unknown> = {};
  if (settingsConfigRaw && typeof settingsConfigRaw === "object" && !Array.isArray(settingsConfigRaw)) {
    settingsConfig = settingsConfigRaw as Record<string, unknown>;
  }
  return { id, name, settingsConfig };
}

/** v3 db 行数组 → 按引擎分组。appType 直读(codemoss ccs_app_key)优先,缺省走启发式。 */
export function parseCcSwitchDbRows(rows: CcSwitchDbRow[]): Map<SupportedEngineId, CcSwitchRawEntry[]> {
  const buckets = new Map<SupportedEngineId, CcSwitchRawEntry[]>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id) continue;
    let sc: Record<string, unknown> = {};
    if (typeof row.settingsConfig === "string" && row.settingsConfig.trim()) {
      try {
        const parsed: unknown = JSON.parse(row.settingsConfig);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          sc = parsed as Record<string, unknown>;
        }
      } catch {
        // 单行坏 JSON → 视为空对象,继续(不阻断整批,沿 codemoss 纪律)
      }
    }
    const engine = inferEngineFromApp(row.appType, sc);
    if (!engine) continue;
    const list = buckets.get(engine) ?? [];
    list.push({ id: row.id, name: row.name || row.id, settingsConfig: sc });
    buckets.set(engine, list);
  }
  return buckets;
}

/** 引擎判定:app_type 直读(codemoss ccs_app_key 同款映射)优先;老 schema 缺列时按
 *  settingsConfig 形状启发(ANTHROPIC_* → claude;OPENAI_API_KEY 或 base_url/model → codex);
 *  两路都无信息 → 跳过(不猜)。 */
function inferEngineFromApp(
  appType: string | undefined,
  settingsConfig: Record<string, unknown>,
): SupportedEngineId | null {
  if (appType === "claude" || appType === "codex") return appType;
  // grokbuild 等 tmd 未接的引擎 → 走启发式也无害(形状不带 ANTHROPIC/OPENAI 键时自然跳过)
  // settingsConfig.env.ANTHROPIC_* → claude;settingsConfig.env.OPENAI_API_KEY 或 model 字段 → codex。
  const env = settingsConfig.env;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const e = env as Record<string, unknown>;
    if (typeof e.ANTHROPIC_BASE_URL === "string" || typeof e.ANTHROPIC_AUTH_TOKEN === "string"
        || typeof e.ANTHROPIC_API_KEY === "string") {
      return "claude";
    }
    if (typeof e.OPENAI_API_KEY === "string" || typeof e.OPENAI_API_BASE_URL === "string") {
      return "codex";
    }
  }
  if (typeof settingsConfig.base_url === "string" || typeof settingsConfig.model === "string") {
    return "codex";
  }
  // 兜底:无信息时跳过(不猜)。
  return null;
}

/** 归一到 tmd Channel(只摊平三个核心字段,其他 settingsConfig 不保留到 UI 形态)。 */
export function normalizeProvider(
  engine: SupportedEngineId,
  raw: CcSwitchRawEntry,
  now: number = Date.now(),
): Channel {
  const base: Channel = {
    id: `ccs_${engine}_${raw.id}`,
    name: raw.name,
    source: "cc-switch",
    ccsId: raw.id,
    createdAt: now,
  };
  if (engine === "claude") {
    const env = envOf(raw.settingsConfig);
    const baseUrl = typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : undefined;
    const apiKey =
      typeof env.ANTHROPIC_AUTH_TOKEN === "string"
        ? env.ANTHROPIC_AUTH_TOKEN
        : typeof env.ANTHROPIC_API_KEY === "string"
          ? env.ANTHROPIC_API_KEY
          : undefined;
    const model = typeof env.ANTHROPIC_MODEL === "string" ? env.ANTHROPIC_MODEL : undefined;
    return { ...base, baseUrl, apiKey, model };
  }
  // codex
  const sc = raw.settingsConfig;
  const baseUrl =
    typeof sc.base_url === "string"
      ? sc.base_url
      : typeof sc.baseUrl === "string"
        ? sc.baseUrl
        : undefined;
  const env = envOf(sc);
  const apiKey =
    typeof env.OPENAI_API_KEY === "string"
      ? env.OPENAI_API_KEY
      : typeof (sc.auth as Record<string, unknown> | undefined)?.OPENAI_API_KEY === "string"
        ? ((sc.auth as Record<string, unknown>).OPENAI_API_KEY as string)
        : undefined;
  const model = typeof sc.model === "string" ? sc.model : undefined;
  return { ...base, baseUrl, apiKey, model };
}

function envOf(obj: Record<string, unknown>): Record<string, unknown> {
  const env = obj.env;
  return env && typeof env === "object" && !Array.isArray(env) ? (env as Record<string, unknown>) : {};
}

/** 整批归一 + 去重结果。同 engine 内同 ccsId 的返回 { existing, incoming } 给调用方决定
 *  是更新已有(替换 baseUrl/apiKey/model/name)还是新增。 */
export function dedupeCcSwitchImport(
  existingByCcsId: Map<string, Channel>,
  incoming: Channel[],
): { updated: Channel[]; added: Channel[]; skipped: Channel[] } {
  const updated: Channel[] = [];
  const added: Channel[] = [];
  const skipped: Channel[] = [];
  for (const ch of incoming) {
    if (!ch.ccsId) {
      skipped.push(ch);
      continue;
    }
    const cur = existingByCcsId.get(ch.ccsId);
    if (cur) {
      // 已有同名 ccsId 条目 → 字段更新,id 沿用(避免 store map key 抖动)
      updated.push({
        ...cur,
        name: ch.name,
        baseUrl: ch.baseUrl,
        apiKey: ch.apiKey,
        model: ch.model,
      });
    } else {
      added.push(ch);
    }
  }
  return { updated, added, skipped };
}

/** 探测 cc-switch 源(v3 db 优先),给「未检测到」提示与双源分流用。列目录一次拿全,不整读文件。 */
export async function probeCcSwitch(): Promise<"v3-db" | "v2-json" | "none"> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return "none";
  let names: string[] = [];
  try {
    names = (await ipc.fsCollectFiles(`${home}/.cc-switch`, "")).map((f) => f.name);
  } catch {
    return "none";
  }
  if (names.includes("cc-switch.db")) return "v3-db";
  if (names.includes("config.json")) return "v2-json";
  return "none";
}

/** cc-switch v2 JSON 读取并解析;home = configHomeDir 返回值。 */
export async function readCcSwitchV2(home: string): Promise<Map<SupportedEngineId, CcSwitchRawEntry[]>> {
  const text = await ipc.fsReadFile(`${home}/.cc-switch/config.json`);
  return parseCcSwitchJson(text);
}

/** cc-switch v3 SQLite 读取并解析。app_type 列直读(codemoss v3 稳定 schema);
 *  查询失败(老 schema 缺列)退回无 app_type 查询 + 启发式。 */
export async function readCcSwitchV3(home: string): Promise<Map<SupportedEngineId, CcSwitchRawEntry[]>> {
  const db = `${home}/.cc-switch/cc-switch.db`;
  const order = " ORDER BY sort_index, created_at";
  try {
    const rows = (await ipc.sqliteQuery(
      db,
      `SELECT id, name, settings_config, app_type FROM providers${order}`,
      [],
    )) as Array<[string, string, string, string]>;
    return parseCcSwitchDbRows(
      rows.map(([id, name, settingsConfig, appType]) => ({ id, name, settingsConfig, appType })),
    );
  } catch {
    const rows = (await ipc.sqliteQuery(
      db,
      `SELECT id, name, settings_config FROM providers${order}`,
      [],
    )) as Array<[string, string, string]>;
    return parseCcSwitchDbRows(rows.map(([id, name, settingsConfig]) => ({ id, name, settingsConfig })));
  }
}
