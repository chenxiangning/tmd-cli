/**
 * 三源 registry 卡片归一 + 安装草稿生成(纯函数,测试直打;网络在
 * registrySources)。统一卡片 McpRegistryCard;installDraft = 可直接落位的
 * server 配置(值可含 {VAR} 占位,由模板系统扫描生成 ConfigInput);
 * manualDraft = 需用户确认 command 的 stdio 草稿(official 包指引 /
 * smithery stdio run / glama npx 建议)。应用值语义:
 * url = 占位替换(无占位则附查询参数);env/header = 写键值;
 * argument = 替换 args 内 {VAR}(无占位则追加)。
 */

import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";

export type RegistrySourceName = "official" | "smithery" | "glama";

export interface ConfigInput {
  name: string;
  label: string;
  required: boolean;
  secret: boolean;
  target: "url" | "env" | "header" | "argument";
}

export interface InstallDraft {
  /** 中性 server 形状(无 type 字段;落位时按目标引擎方言补齐)。 */
  server: McpServerEntry;
  configInputs: ConfigInput[];
}

export interface RegistryCard {
  source: RegistrySourceName;
  id: string;
  name: string;
  description: string;
  url?: string;
  toolsCount?: number;
  installDraft?: InstallDraft;
  manualDraft?: InstallDraft;
}

type RawRecord = Record<string, unknown>;

/** 外部 JSON 收窄守卫(registrySources 共用;非对象回 {}、非数组回 []、有限数回原值)。 */
export function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 占位符 {NAME} 扫描(标识符字符集)。 */
export function templateNames(value: string): string[] {
  return Array.from(value.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g), (m) => m[1]);
}

/** server id 建议名:卡片名 → 小写连字符 slug。 */
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp-server";
}

function dedupInputs(inputs: ConfigInput[]): ConfigInput[] {
  return inputs.filter(
    (input, i, all) => all.findIndex((x) => x.target === input.target && x.name === input.name) === i,
  );
}

/** 模板扫描:url 与 headers 值 / args 条目中的 {VAR} → 对应 target 输入。 */
function scanPlaceholders(server: McpServerEntry): ConfigInput[] {
  const inputs: ConfigInput[] = [];
  const push = (name: string, target: ConfigInput["target"]) =>
    inputs.push({ name, label: name, required: true, secret: isSecretName(name), target });
  if (typeof server.url === "string") {
    for (const n of templateNames(server.url)) push(n, "url");
  }
  for (const header of Object.values(asRecord(server.headers))) {
    if (typeof header === "string") for (const n of templateNames(header)) push(n, "header");
  }
  if (Array.isArray(server.args)) {
    for (const arg of server.args) {
      if (typeof arg === "string") for (const n of templateNames(arg)) push(n, "argument");
    }
  }
  return inputs;
}

function isSecretName(name: string): boolean {
  return /token|secret|key|password|authorization|credential/i.test(name);
}

/** 组装草稿:占位扫描 + 已声明输入去重合并。 */
export function makeDraft(server: McpServerEntry, declared: ConfigInput[] = []): InstallDraft {
  return { server, configInputs: dedupInputs([...declared, ...scanPlaceholders(server)]) };
}

/* ── official(registry.modelcontextprotocol.io/v0.1)── */

function officialRemoteDraft(server: RawRecord): InstallDraft | undefined {
  for (const remote of asArray(server.remotes)) {
    const rec = asRecord(remote);
    const type = asString(rec.type);
    if (type !== "streamable-http" && type !== "http" && type !== "sse") continue;
    const url = asString(rec.url);
    if (!url) continue;
    const headers: Record<string, string> = {};
    for (const header of asArray(rec.headers)) {
      const h = asRecord(header);
      const name = asString(h.name);
      if (!name) continue;
      headers[name] = asString(h.value) ?? `{${asString(h.valueHint) ?? name}}`;
    }
    return makeDraft({ url, headers });
  }
  return undefined;
}

function officialPackageDraft(server: RawRecord): InstallDraft | undefined {
  for (const pkg of asArray(server.packages)) {
    const p = asRecord(pkg);
    const identifier = asString(p.identifier);
    const registryType = asString(p.registryType);
    if (!identifier) continue;
    const command = asString(p.runtimeHint) ?? (registryType === "pypi" ? "uvx" : "npx");
    if (command !== "npx" && command !== "uvx") continue;

    const args: string[] = [];
    const env: Record<string, string> = {};
    const declared: ConfigInput[] = [];
    for (const arg of [...asArray(p.runtimeArguments), ...asArray(p.packageArguments)]) {
      const a = asRecord(arg);
      const value = asString(a.value) ?? asString(a.default);
      if (value) args.push(value);
      else if (a.isRequired === true) {
        const hint = asString(a.valueHint) ?? asString(a.name) ?? "ARG";
        args.push(`{${hint}}`);
      }
    }
    for (const variable of asArray(p.environmentVariables)) {
      const v = asRecord(variable);
      const name = asString(v.name);
      if (!name) continue;
      const value = asString(v.value) ?? asString(v.default);
      if (value) env[name] = value;
      else
        declared.push({
          name,
          label: asString(v.description) ?? name,
          required: v.isRequired !== false,
          secret: v.isSecret === true || isSecretName(name),
          target: "env",
        });
    }
    return makeDraft({ command, args: [...args, identifier], env }, declared);
  }
  return undefined;
}

export function normalizeOfficial(raw: unknown): RegistryCard | null {
  const record = asRecord(raw);
  const server = asRecord(record.server ?? raw);
  const name = asString(server.name);
  if (!name) return null;
  return {
    source: "official",
    id: `official:${name}:${asString(server.version) ?? "latest"}`,
    name,
    description: asString(server.description) ?? "",
    url: asString(server.websiteUrl) ?? asString(asRecord(server.repository).url),
    installDraft: officialRemoteDraft(server),
    manualDraft: officialPackageDraft(server),
  };
}

/* ── Smithery(api.smithery.ai)── */

export function normalizeSmitherySearch(raw: unknown): RegistryCard | null {
  const item = asRecord(raw);
  const qualifiedName = asString(item.qualifiedName) ?? asString(item.name) ?? asString(item.id);
  if (!qualifiedName) return null;
  return {
    source: "smithery",
    id: `smithery:${qualifiedName}`,
    name: qualifiedName,
    description: asString(item.description) ?? "",
    url: asString(item.homepage),
    toolsCount: asNumber(item.toolsCount),
  };
}

/** Smithery JSON Schema(properties/required + x-from 定位)→ ConfigInput。 */
export function configInputsFromJsonSchema(
  schema: unknown,
  fallbackTarget: ConfigInput["target"] = "url",
): ConfigInput[] {
  const record = asRecord(schema);
  const required = new Set(asArray(record.required).map((r) => asString(r)).filter(Boolean) as string[]);
  const inputs: ConfigInput[] = [];
  for (const [name, rawProperty] of Object.entries(asRecord(record.properties))) {
    const property = asRecord(rawProperty);
    inputs.push({
      name,
      label: asString(property.title) ?? name,
      required: required.has(name),
      secret: isSecretName(name),
      target: fallbackTarget,
    });
  }
  return inputs;
}

/** 详情回落:deploymentUrl → installDraft;stdio 连接 → manualDraft(--config 模板)。 */
export function applySmitheryDetail(card: RegistryCard, raw: unknown): RegistryCard {
  const item = asRecord(raw);
  const connections = asArray(item.connections).map(asRecord);
  const http = connections.find(
    (c) => asString(c.type) === "http" && (asString(c.deploymentUrl) ?? asString(item.deploymentUrl)),
  );
  const stdio = connections.find((c) => asString(c.type) === "stdio");
  const deploymentUrl = asString(item.deploymentUrl) ?? asString(http?.deploymentUrl);

  const installDraft = deploymentUrl
    ? makeDraft(
        { url: deploymentUrl },
        configInputsFromJsonSchema(http?.configSchema, "url").map((input) => ({ ...input, required: true })),
      )
    : undefined;

  let manualDraft: InstallDraft | undefined;
  if (stdio) {
    const inputs = configInputsFromJsonSchema(stdio.configSchema, "argument").filter((i) => i.required);
    const configTemplate = inputs.length
      ? JSON.stringify(Object.fromEntries(inputs.map((i) => [i.name, `{${i.name}}`])))
      : undefined;
    manualDraft = makeDraft(
      {
        command: "npx",
        args: ["-y", "@smithery/cli@latest", "run", card.name, ...(configTemplate ? ["--config", configTemplate] : [])],
      },
      inputs,
    );
  }
  return { ...card, installDraft, manualDraft, toolsCount: asNumber(asArray(item.tools).length) || card.toolsCount };
}

/* ── Glama(glama.ai;API 现 401 时走源级错误态)── */

export function normalizeGlama(raw: unknown): RegistryCard | null {
  const item = asRecord(raw);
  const id = asString(item.id) ?? asString(item.slug) ?? asString(item.name);
  const name = asString(item.name) ?? asString(item.slug) ?? id;
  if (!id || !name) return null;
  const envSchema = item.environmentVariablesJsonSchema;
  const inputs = configInputsFromJsonSchema(envSchema, "env");
  const env: Record<string, string> = {};
  for (const input of inputs) {
    const value = asString(asRecord(asRecord(envSchema).value)[input.name]);
    if (value) env[input.name] = value;
  }
  const packageName = asString(item.packageName) ?? asString(item.npmPackage) ?? asString(item.slug) ?? name;
  return {
    source: "glama",
    id: `glama:${id}`,
    name,
    description: asString(item.description) ?? "",
    url: asString(item.url) ?? asString(asRecord(item.repository).url),
    toolsCount: asNumber(item.toolsCount) ?? (asArray(item.tools).length || undefined),
    manualDraft: makeDraft({ command: "npx", args: ["-y", packageName], env }, inputs),
  };
}

/* ── 应用值:草稿 + 用户填值 → 最终 server 条目(中性形状,无 type)── */

export function applyDraftValues(draft: InstallDraft, values: Record<string, string>): McpServerEntry {
  const server: McpServerEntry = structuredClone(draft.server);
  for (const input of draft.configInputs) {
    const value = (values[`${input.target}:${input.name}`] ?? values[input.name] ?? "").trim();
    if (!value) continue;
    if (input.target === "env") {
      server.env = { ...asRecord(server.env), [input.name]: value };
    } else if (input.target === "header") {
      server.headers = { ...asRecord(server.headers), [input.name]: value };
    } else if (input.target === "argument") {
      const args = Array.isArray(server.args) ? [...(server.args as string[])] : [];
      const hit = args.findIndex((a) => typeof a === "string" && a.includes(`{${input.name}}`));
      server.args = hit >= 0 ? args.map((a, i) => (i === hit ? a.split(`{${input.name}}`).join(value) : a)) : [...args, value];
    } else {
      const url = typeof server.url === "string" ? server.url : "";
      server.url = url.includes(`{${input.name}}`)
        ? url.split(`{${input.name}}`).join(encodeURIComponent(value))
        : `${url}${url.includes("?") ? "&" : "?"}${encodeURIComponent(input.name)}=${encodeURIComponent(value)}`;
    }
  }
  return server;
}
