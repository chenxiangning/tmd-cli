/**
 * Claude Code 图形化配置面 —— settings.json 的 schema + JSON 合并 load/save。
 *
 * 托管 = 顶层三键 + env 七键;hooks / permissions / enabledPlugins 等
 * 结构化段不碰,合并写回时原键序保留。API Key 走 secret 控件(默认掩码)。
 * 只写变过的键:load 的缺省值(includeCoAuthoredBy=true 等)不会凭空写/删。
 */

import { ipc } from "@kernel/ipc";
import type { CliConfigEntry, CliConfigSource, CliConfigValues } from "@kernel/cliConfigRegistry";
import { t } from "@kernel/i18n";

/** env 托管键:表单 id → 磁盘 env 变量名(envModel 与顶层 model 键位不同源)。 */
const ENV_KEYS = {
  baseUrl: "ANTHROPIC_BASE_URL",
  apiKey: "ANTHROPIC_API_KEY",
  envModel: "ANTHROPIC_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  timeout: "API_TIMEOUT_MS",
} as const;

const CLAUDE_MODEL_ALIASES = ["default", "fable", "sonnet", "opus", "haiku"];

/** 模型候选 = 内置别名 + settings.json env 实况(ANTHROPIC_MODEL / DEFAULT_* 已配的具体模型 id)。 */
function claudeModelOptions(values: CliConfigValues): string[] {
  const fromEnv = [values.envModel, values.opus, values.sonnet, values.haiku]
    .map((v) => (typeof v === "string" ? v : ""))
    .filter((v) => v && !CLAUDE_MODEL_ALIASES.includes(v));
  return [...CLAUDE_MODEL_ALIASES, ...fromEnv];
}

async function sources(): Promise<CliConfigSource[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const path = `${home}/.claude/settings.json`;
  const exists = await ipc.fsReadFile(path).then(() => true).catch(() => false);
  return [{ id: "global", label: t("全局配置"), path, exists }];
}

function parse(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error(t("settings.json 顶层必须是对象"));
  return v as Record<string, unknown>;
}

const str = (o: Record<string, unknown>, k: string): string =>
  typeof o[k] === "string" ? (o[k] as string) : "";

export function loadClaudeConfig(raw: string): CliConfigValues {
  const o = parse(raw);
  const env = (
    o.env && typeof o.env === "object" && !Array.isArray(o.env) ? o.env : {}
  ) as Record<string, unknown>;
  const out: CliConfigValues = {
    model: str(o, "model"),
    alwaysThinkingEnabled: o.alwaysThinkingEnabled === true,
    includeCoAuthoredBy: o.includeCoAuthoredBy !== false,
  };
  for (const [id, name] of Object.entries(ENV_KEYS)) out[id] = str(env, name);
  return out;
}

export function saveClaudeConfig(raw: string, v: CliConfigValues): string {
  const base = loadClaudeConfig(raw);
  const o = parse(raw);
  const changed = (k: string) => JSON.stringify(v[k]) !== JSON.stringify(base[k]);
  if (changed("model")) {
    if (typeof v.model === "string" && v.model.trim()) o.model = v.model.trim();
    else delete o.model;
  }
  if (changed("alwaysThinkingEnabled")) o.alwaysThinkingEnabled = v.alwaysThinkingEnabled === true;
  if (changed("includeCoAuthoredBy")) {
    if (v.includeCoAuthoredBy === false) o.includeCoAuthoredBy = false;
    else delete o.includeCoAuthoredBy;
  }
  const touched = Object.keys(ENV_KEYS).filter(changed);
  if (touched.length) {
    const env = (
      o.env && typeof o.env === "object" && !Array.isArray(o.env) ? o.env : {}
    ) as Record<string, unknown>;
    for (const id of touched) {
      const val = v[id];
      const name = ENV_KEYS[id as keyof typeof ENV_KEYS];
      if (typeof val === "string" && val.trim()) env[name] = val.trim();
      else delete env[name];
    }
    if (Object.keys(env).length) o.env = env;
    else delete o.env;
  }
  return JSON.stringify(o, null, 2) + "\n";
}

export const claudeConfigEntry: Omit<CliConfigEntry, "icon"> = {
  id: "claude",
  title: "Claude Code",
  order: 2,
  sources,
  load: loadClaudeConfig,
  save: saveClaudeConfig,
  fields: [
    {
      id: "model",
      kind: "select",
      label: "默认模型",
      hint: "model(顶层键);候选 = 内置别名 + env 实况",
      options: claudeModelOptions,
    },
    {
      id: "alwaysThinkingEnabled",
      kind: "toggle",
      label: "始终思考",
      hint: "alwaysThinkingEnabled",
    },
    {
      id: "includeCoAuthoredBy",
      kind: "toggle",
      label: "提交署名",
      hint: "includeCoAuthoredBy:关闭则 git 提交不带 Co-Authored-By",
    },
    { id: "baseUrl", kind: "text", label: "API 地址", hint: "env.ANTHROPIC_BASE_URL" },
    {
      id: "apiKey",
      kind: "secret",
      label: "API Key",
      hint: "env.ANTHROPIC_API_KEY;仅写入磁盘,默认掩码",
    },
    { id: "envModel", kind: "text", label: "主模型覆盖", hint: "env.ANTHROPIC_MODEL" },
    {
      id: "opus",
      kind: "text",
      label: "Opus 档覆盖",
      hint: "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
      advanced: true,
    },
    {
      id: "sonnet",
      kind: "text",
      label: "Sonnet 档覆盖",
      hint: "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      advanced: true,
    },
    {
      id: "haiku",
      kind: "text",
      label: "Haiku 档覆盖",
      hint: "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      advanced: true,
    },
    {
      id: "timeout",
      kind: "text",
      label: "请求超时(ms)",
      hint: "env.API_TIMEOUT_MS",
      advanced: true,
    },
  ],
};
