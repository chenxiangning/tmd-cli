/**
 * pi 本地配置读取 —— 自 quota.ts 拆出(文件规模铁则)。
 *
 * 凭据源(实证 ~/.pi/agent,目录可被 PI_CODING_AGENT_DIR 覆盖):
 * - auth.json: Record<providerId, { key } | { access, accountId, refresh, expires, type }>
 *   本机实证 vendors: deepseek / kimi-coding / minimax-cn / openai-codex / zai-coding-cn
 * - models-store.json: Record<providerId, { models: [{ id }] }>
 *   裸模型 id → provider 反查(session jsonl 只有 modelId 没有 provider 时用)。
 * - models.json (JSONC): Record<providerId, { baseUrl, apiKey, models }>
 *   中转站 baseUrl 与 apiKey 的真实来源(auth.json 无中转站条目)。
 * parseJsonc / piAgentDir / PiLocalConfig 由 quota.ts re-export 维持既有导入契约。
 */

import { ipc } from "@kernel/ipc";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/* ── JSONC 解析(models.json 带注释)────────────────────── */

/**
 * 最小 JSONC 归一:剥离 // 与 块注释、尾逗号,字符串字面量原样保留。
 * pi models.json 实证只有这两种非标准语法,不引入第三方解析器。
 */
export function parseJsonc(raw: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // 尾逗号: , 后直接跟 } 或 ](允许中间空白)
  const noTrailing = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailing);
}

/* ── 磁盘读取(薄 IO)────────────────────────────────────── */

export type PiAuthEntry = {
  key?: string;
  access?: string;
  accountId?: string;
};

/** models-store.json 实证只有 models 列表(baseUrl 只存在于 models.json)。 */
export type PiStoreProvider = {
  models?: Array<{ id?: string }>;
};

export type PiModelsJsonProvider = {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id?: string }>;
};

/** pi 全部本地配置,一次读齐喂给纯路由函数。 */
export interface PiLocalConfig {
  auth: Record<string, PiAuthEntry>;
  store: Record<string, PiStoreProvider>;
  modelsJson: Record<string, PiModelsJsonProvider>;
}

/** pi 配置目录默认 ~/.pi/agent;允许 PI_CODING_AGENT_DIR 覆盖。 */
export async function piAgentDir(): Promise<string> {
  const configured = await ipc.quotaEnvValue(AGENT_DIR_ENV);
  if (configured) return configured.replace(/[\\/]+$/, "");
  return `${await ipc.configHomeDir()}/.pi/agent`;
}

/** JSON 边界收窄:object → Record;字段级类型由消费点 typeof 守卫。 */
function asStringKeyedMap(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // 已通过 typeof 收窄为 object;字段值保持 unknown,消费点逐一校验。
    const map: Record<string, unknown> = v as Record<string, unknown>;
    return map;
  }
  return {};
}

export async function readPiLocalConfig(): Promise<PiLocalConfig> {
  const dir = await piAgentDir();
  const [authRaw, storeRaw, modelsRaw] = await Promise.all([
    ipc.fsReadFile(`${dir}/auth.json`).then(JSON.parse).catch(() => null),
    ipc.fsReadFile(`${dir}/models-store.json`).then(JSON.parse).catch(() => null),
    ipc.fsReadFile(`${dir}/models.json`).then(parseJsonc).catch(() => null),
  ]);
  const modelsMap = asStringKeyedMap(modelsRaw);
  const providersRaw = "providers" in modelsMap ? modelsMap.providers : null;
  return {
    auth: asStringKeyedMap(authRaw) as PiLocalConfig["auth"],
    store: asStringKeyedMap(storeRaw) as PiLocalConfig["store"],
    modelsJson: asStringKeyedMap(providersRaw) as PiLocalConfig["modelsJson"],
  };
}
