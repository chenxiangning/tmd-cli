/**
 * pi 图形化配置面 —— ~/.pi/agent/settings.json 的 schema + load/save 纯函数。
 *
 * pi 设置是单一扁平 JSON,写回 = 合并托管键(JSON.stringify 整体重写,
 * 未知键天然保留);值与键同语义时空值 = 删键 = 回落 CLI 内置默认;
 * 只写变过的键:load 缺省值(theme=dark 等)不会被凭空插入磁盘。
 *
 * 默认模型 = 「供应商 → 模型」两级选择:catalog 实况来自
 * auth.json(已登录供应商) × models-store.json(各供应商已支持的模型)。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type {
  CliConfigEntry,
  CliConfigSource,
  CliConfigValues,
  CliModelCatalogProvider,
} from "@kernel/cliConfigRegistry";

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("配置文件不是 JSON 对象"));
  }
  return parsed as Record<string, unknown>;
}
/** 合并写回:整文件 JSON.stringify(缩进 2 + 尾换行),未知键天然保留。 */
function saveManagedKeys(next: Record<string, unknown>): string {
  return `${JSON.stringify(next, null, 2)}\n`;
}

const PI_SETTINGS_PATH = ".pi/agent/settings.json";
const PI_THINKING = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"];
const PI_THEMES = ["dark", "light"];

async function piConfigSources(): Promise<CliConfigSource[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const path = `${home}/${PI_SETTINGS_PATH}`;
  const exists = await ipc.fsReadFile(path).then(() => true).catch(() => false);
  return [{ id: "global", label: t("全局配置"), path, exists }];
}

export function loadPiConfig(raw: string): CliConfigValues {
  const o = parseJsonObject(raw);
  const provider = typeof o.defaultProvider === "string" ? o.defaultProvider : "";
  const model = typeof o.defaultModel === "string" ? o.defaultModel : "";
  return {
    defaultModel: provider && model ? `${provider}/${model}` : model || provider,
    defaultThinkingLevel:
      typeof o.defaultThinkingLevel === "string" ? o.defaultThinkingLevel : "",
    theme: typeof o.theme === "string" ? o.theme : "dark",
  };
}

export function savePiConfig(raw: string, v: CliConfigValues): string {
  const base = loadPiConfig(raw);
  const next = parseJsonObject(raw);
  const changed = (k: string) => JSON.stringify(v[k]) !== JSON.stringify(base[k]);
  const raw1 = String(v.defaultModel ?? "");
  const slash = raw1.indexOf("/");
  const provider = slash > 0 ? raw1.slice(0, slash) : "";
  const model = slash > 0 ? raw1.slice(slash + 1) : raw1;
  if (changed("defaultModel")) {
    if (provider) next.defaultProvider = provider;
    if (model) next.defaultModel = model;
    else delete next.defaultModel;
    if (!raw1) delete next.defaultProvider;
  }
  if (changed("defaultThinkingLevel")) {
    if (typeof v.defaultThinkingLevel === "string" && v.defaultThinkingLevel) {
      next.defaultThinkingLevel = v.defaultThinkingLevel;
    } else {
      delete next.defaultThinkingLevel;
    }
  }
  if (changed("theme")) {
    if (typeof v.theme === "string" && v.theme) next.theme = v.theme;
    else delete next.theme;
  }
  return saveManagedKeys(next);
}

/** 实况目录:auth.json 的键 = 已登录供应商;models-store.json 给各供应商模型清单。 */
export async function piModelCatalog(): Promise<CliModelCatalogProvider[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const readJson = async (rel: string): Promise<Record<string, unknown>> => {
    try {
      const parsed: unknown = JSON.parse(await ipc.fsReadFile(`${home}/.pi/agent/${rel}`));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  const [auth, store] = await Promise.all([
    readJson("auth.json"),
    readJson("models-store.json"),
  ]);
  const out: CliModelCatalogProvider[] = [];
  for (const id of Object.keys(store)) {
    const entry = store[id];
    const list =
      entry && typeof entry === "object" && Array.isArray((entry as { models?: unknown }).models)
        ? ((entry as { models: unknown[] }).models as unknown[])
        : [];
    const models: Array<{ id: string; label?: string }> = [];
    for (const m of list) {
      if (!m || typeof m !== "object") continue;
      const rec = m as Record<string, unknown>;
      if (typeof rec.id !== "string") continue;
      models.push({ id: rec.id, ...(typeof rec.name === "string" ? { label: rec.name } : {}) });
    }
    if (models.length > 0) out.push({ id, models, authed: id in auth });
  }
  out.sort((a, b) => Number(b.authed) - Number(a.authed) || a.id.localeCompare(b.id));
  return out;
}

export const piConfigEntry: Omit<CliConfigEntry, "icon"> = {
  id: "pi",
  title: "pi",
  order: 1,
  sources: piConfigSources,
  load: loadPiConfig,
  save: savePiConfig,
  fields: [
    {
      id: "defaultModel",
      label: t("默认模型"),
      kind: "select",
      catalog: piModelCatalog,
    },
    {
      id: "defaultThinkingLevel",
      label: t("默认思考强度"),
      kind: "select",
      options: ["", ...PI_THINKING],
    },
    {
      id: "theme",
      label: t("CLI 主题"),
      kind: "select",
      options: PI_THEMES,
    },
  ],
};
