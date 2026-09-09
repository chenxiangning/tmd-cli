/**
 * Codex 图形化配置面 —— config.toml 顶层平面键的 schema + 行级补丁 load/save。
 *
 * 写回纪律:只动首个 [section] 之前的顶层 `key = value` 行(缺失则在区段尾
 * 插行);[model_providers.*] / [projects] / [mcp_servers] / [plugins] /
 * [desktop] 等托管段与注释逐字节保留 —— 整文件 parse→reserialize 会毁掉它们。
 * TOML 键知识留本插件(单插件语义,不入 kernel)。
 */

import { ipc } from "@kernel/ipc";
import type { CliConfigEntry, CliConfigSource, CliConfigValues } from "@kernel/cliConfigRegistry";
import { t } from "@kernel/i18n";

/** 已知 codex 模型兜底(catalog 文件缺失时用;实况优先)。 */
const CODEX_KNOWN_MODELS = ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"];

/** [model_providers.NAME] 段名 = 服务商候选(用户自己的配置实况)。 */
export function parseProviderNames(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\[model_providers\.([\w.-]+)\]\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 模型候选实况:config.toml 的 model_catalog_json 指向的目录文件(models[].slug)。 */
async function codexModelOptions(): Promise<string[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return CODEX_KNOWN_MODELS;
  try {
    const toml = await ipc.fsReadFile(`${home}/.codex/config.toml`);
    const file = toml.match(/^model_catalog_json\s*=\s*"([^"]+)"/m)?.[1];
    if (!file) return CODEX_KNOWN_MODELS;
    const path = file.startsWith("/") ? file : `${home}/.codex/${file}`;
    const parsed: unknown = JSON.parse(await ipc.fsReadFile(path));
    const models =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
            .map((m) =>
              m && typeof m === "object" && typeof (m as { slug?: unknown }).slug === "string"
                ? (m as { slug: string }).slug
                : null,
            )
            .filter((s): s is string => s !== null)
        : [];
    return models.length > 0 ? models : CODEX_KNOWN_MODELS;
  } catch {
    return CODEX_KNOWN_MODELS;
  }
}

/** 托管顶层键:表单 id → 磁盘 TOML 键(布尔/字符串两类)。 */
const MANAGED = [
  "model",
  "model_provider",
  "model_reasoning_effort",
  "web_search",
  "disable_response_storage",
  "service_tier",
] as const;

/** 顶层区段 = 首个 [section] 头之前的行。 */
function topLevelEnd(lines: string[]): number {
  const i = lines.findIndex((l) => /^\s*\[/.test(l));
  return i < 0 ? lines.length : i;
}

function unquote(raw: string): string {
  const v = raw.trim().replace(/\s+#(?![^'"]*$).*$/, "").trim();
  return /^".*"$/.test(v) || /^'.*'$/.test(v) ? v.slice(1, -1) : v;
}

function getToml(lines: string[], key: string): string {
  for (let i = 0; i < topLevelEnd(lines); i++) {
    const m = lines[i].match(new RegExp(`^${key}\\s*=\\s*(.*)$`));
    if (m) return unquote(m[1]);
  }
  return "";
}

function setToml(lines: string[], key: string, value: string | boolean | null): string[] {
  const out = [...lines];
  const end = topLevelEnd(out);
  if (value === null) {
    // 删除分支:与 claude/pi 的「空值删键」语义对齐
    for (let i = 0; i < end; i++) {
      if (new RegExp(`^${key}\\s*=`).test(out[i])) {
        out.splice(i, 1);
        return out;
      }
    }
    return out;
  }
  const rendered = typeof value === "boolean" ? (value ? "true" : "false") : JSON.stringify(value);
  for (let i = 0; i < end; i++) {
    if (new RegExp(`^${key}\\s*=`).test(out[i])) {
      out[i] = `${key} = ${rendered}`;
      return out;
    }
  }
  out.splice(end, 0, `${key} = ${rendered}`);
  return out;
}

async function sources(): Promise<CliConfigSource[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const path = `${home}/.codex/config.toml`;
  const exists = await ipc.fsReadFile(path).then(() => true).catch(() => false);
  return [
    {
      id: "global",
      label: t("全局配置"),
      path,
      exists,
      note: t(
        "config.toml 的 [model_providers] / [projects] / [mcp_servers] 等段由 Codex 自管理;GUI 只编辑顶层平面键,保存为行级补丁,未知段落与注释原样保留。",
      ),
    },
  ];
}

export function loadCodexConfig(raw: string): CliConfigValues {
  const L = raw.split("\n");
  return {
    model: getToml(L, "model"),
    model_provider: getToml(L, "model_provider"),
    model_reasoning_effort: getToml(L, "model_reasoning_effort") || "medium",
    web_search: getToml(L, "web_search") || "enabled",
    disable_response_storage: getToml(L, "disable_response_storage") === "true",
    service_tier: getToml(L, "service_tier") || "default",
    /** 非托管:服务商候选实况(从 [model_providers.*] 段名解析,save 忽略)。 */
    providers: parseProviderNames(raw),
  };
}

export function saveCodexConfig(raw: string, v: CliConfigValues): string {
  const base = loadCodexConfig(raw);
  let L = raw.split("\n");
  /* 只写变过的键:load 缺省值(web_search=enabled 等)不会被凭空插入;
     文本键清空 = 删顶层行,与 claude/pi 空值删键对齐。 */
  for (const key of MANAGED) {
    if (JSON.stringify(v[key]) === JSON.stringify(base[key])) continue;
    const val = v[key];
    if (typeof val === "boolean") L = setToml(L, key, val);
    else if (typeof val === "string" && val.trim()) L = setToml(L, key, val.trim());
    else L = setToml(L, key, null);
  }
  return L.join("\n");
}

export const codexConfigEntry: Omit<CliConfigEntry, "icon"> = {
  id: "codex",
  title: "Codex",
  order: 3,
  sources,
  load: loadCodexConfig,
  save: saveCodexConfig,
  fields: [
    {
      id: "model",
      kind: "select",
      label: "模型",
      hint: "model;候选 = model_catalog_json 目录文件实况",
      options: codexModelOptions,
    },
    {
      id: "model_provider",
      kind: "select",
      label: "服务商",
      hint: "model_provider(引用 [model_providers.*] 段名,候选 = 本文件实况)",
      options: (values) => (Array.isArray(values.providers) ? (values.providers as string[]) : []),
    },
    {
      id: "model_reasoning_effort",
      kind: "select",
      label: "推理力度",
      hint: "model_reasoning_effort",
      options: ["minimal", "low", "medium", "high"],
    },
    {
      id: "web_search",
      kind: "select",
      label: "网页搜索",
      hint: "web_search",
      options: ["disabled", "cached", "enabled"],
    },
    {
      id: "disable_response_storage",
      kind: "toggle",
      label: "禁用响应存储",
      hint: "disable_response_storage",
    },
    {
      id: "service_tier",
      kind: "select",
      label: "服务档位",
      hint: "service_tier",
      options: ["default", "flex", "priority"],
    },
  ],
};
