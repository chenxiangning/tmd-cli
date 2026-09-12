/**
 * omp 自定义供应商(models.yml)读写 —— 中转站 / 自定义模型的用户配置文件。
 *
 * 文件格式(omp fork,camelCase,实测于本机 ~/.omp/agent/models.yml):
 *   providers:
 *     <name>:
 *       baseUrl: https://…
 *       api: openai-responses | openai-completions | …
 *       apiKey: sk-…
 *       models:
 *         - id: …
 *
 * 摘要走 indent 扫描纯函数(kernel yamlBlocks 的 getList 会把嵌套 `- text` 误计入
 * models 数,这里按 `- id:` 精确数模型);保存 = 原文覆盖(.bak-tmd 备份壳)。
 * 不做 YAML 语义校验:omp 下次启动自会报错,编辑器保留原文可回改(已知上限,记 spec)。
 */

import { ipc } from "@kernel/ipc";
import { backupOnce } from "@plugins/cli-shared/providerChannels";

export const MODELS_YML = ".omp/agent/models.yml";

interface OmpCustomProviderSummary {
  name: string;
  baseUrl: string;
  /** 协议(omp 的 api 字段,如 openai-responses)。 */
  api: string;
  modelCount: number;
  hasKey: boolean;
}

export interface OmpModelsConfig {
  path: string;
  exists: boolean;
  raw: string;
  providers: OmpCustomProviderSummary[];
}

/** 空文件模板(缺失时编辑器种子;对齐 codemoss MODELS_TEMPLATE_YAML 语义)。 */
export const MODELS_TEMPLATE = `providers:
  my-relay:
    baseUrl: https://your-relay.example.com/v1
    api: openai-responses
    apiKey: sk-xxx
    models:
      - id: model-id
        name: Model Name
`;

async function ompModelsPath(): Promise<string> {
  const home = await ipc.configHomeDir();
  return `${home}/${MODELS_YML}`;
}

/** providers 块下的二级 key(名字支持引号/连字符,取原始 key 文本)。 */
function providerNames(lines: string[]): string[] {
  const names: string[] = [];
  let inProviders = false;
  for (const l of lines) {
    if (/^providers:\s*$/.test(l)) {
      inProviders = true;
      continue;
    }
    if (!inProviders) continue;
    if (/^\S/.test(l)) break; // 顶层下一个 key,providers 块结束
    const m = l.match(/^ {2}([^#\s][^:]*):\s*$/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

/** 在 [from, to) 行区间内数 `- id:` 项(models 数组的元素首键)。 */
function countModelItems(lines: string[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (/^\s+-\s+id:\s*\S/.test(lines[i])) n++;
  return n;
}

/** 标量字段:在 provider 块内找 `<key>: value`(只认该 provider 缩进层级)。 */
function providerScalar(lines: string[], name: string, key: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^ {2}${esc}:\\s*$`);
  let inBlock = false;
  for (const l of lines) {
    if (re.test(l)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^ {2}\S/.test(l)) break; // 下一个 provider
    const m = l.match(/^ {4}([^#:\s][^:]*):\s*(.*)$/);
    if (m && m[1].trim() === key) return m[2].trim();
  }
  return "";
}

/** models 块行区间(返回起点在 `models:` 行之后)。 */
function modelsRange(lines: string[], name: string): [number, number] {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^ {2}${esc}:\\s*$`);
  let inBlock = false;
  let modelsAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (re.test(l)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^ {2}\S/.test(l)) break;
    if (/^ {4}models:\s*$/.test(l)) modelsAt = i;
  }
  if (modelsAt < 0) return [0, 0];
  // 块尾 = 下一个 ≥4 缩进的非列表行 或 EOF
  let end = lines.length;
  for (let i = modelsAt + 1; i < lines.length; i++) {
    if (/^ {4}[^#\s-]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [modelsAt + 1, end];
}

/** 原文 → 摘要(纯函数,可测)。空/缺 providers = 空列表。 */
export function summarizeModelsConfig(raw: string): OmpCustomProviderSummary[] {
  const lines = raw.split("\n");
  const out: OmpCustomProviderSummary[] = [];
  for (const name of providerNames(lines)) {
    const [from, to] = modelsRange(lines, name);
    out.push({
      name,
      baseUrl: providerScalar(lines, name, "baseUrl"),
      api: providerScalar(lines, name, "api"),
      modelCount: countModelItems(lines, from, to),
      hasKey: providerScalar(lines, name, "apiKey").length > 0,
    });
  }
  return out;
}

/** 读原文 + 摘要;文件缺失 = 不存在态(raw 空、exists=false)。 */
export async function readOmpModelsConfig(): Promise<OmpModelsConfig> {
  const path = await ompModelsPath();
  try {
    const raw = await ipc.fsReadFile(path);
    return { path, exists: true, raw, providers: summarizeModelsConfig(raw) };
  } catch {
    return { path, exists: false, raw: "", providers: [] };
  }
}

/** 保存原文(覆盖;.bak-tmd 备份壳)。 */
export async function saveOmpModelsConfig(raw: string): Promise<void> {
  const path = await ompModelsPath();
  await backupOnce(path);
  await ipc.fsWriteFile(path, raw);
}

/** GUI「添加供应商」表单值。 */
interface OmpCustomProviderInput {
  name: string;
  baseUrl: string;
  api: string;
  /** 可空;建议 `$ENV_VAR` 引用,字面量也可。 */
  apiKey: string;
  /** 模型 id 列表(≥1;每条生成 `- id:` + 同名 name)。 */
  models: string[];
}

const API_VALUES = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

/** 表单校验(纯函数);返回 trim 后的规范化值,坏输入抛错。 */
export function validateProviderInput(
  input: OmpCustomProviderInput,
  existingNames: readonly string[],
): OmpCustomProviderInput {
  const name = input.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
    throw new Error("名称只能用字母/数字/中划线/下划线,且以字母或数字开头");
  if (existingNames.includes(name)) throw new Error(`供应商「${name}」已存在`);
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl || /\s/.test(baseUrl)) throw new Error("API 地址不能为空且不能含空白");
  if (!(API_VALUES as readonly string[]).includes(input.api)) throw new Error(`未知协议: ${input.api}`);
  const apiKey = input.apiKey.trim();
  if (/[\r\n]/.test(apiKey)) throw new Error("API Key 不能包含换行");
  const models = input.models.flatMap((m) => {
    const id = m.trim();
    return id ? [id] : [];
  });
  if (models.length === 0) throw new Error("至少填写一个模型 id");
  if (models.some((m) => /\s/.test(m))) throw new Error("模型 id 不能含空白");
  return { name, baseUrl, api: input.api, apiKey, models };
}

/** 单供应商 YAML 块(缩进 2 起;models 每条 `- id:` + 同名 name)。 */
export function buildProviderBlock(p: OmpCustomProviderInput): string {
  const head = [
    `  ${p.name}:`,
    `    baseUrl: ${p.baseUrl}`,
    `    api: ${p.api}`,
  ];
  if (p.apiKey) head.push(`    apiKey: ${p.apiKey}`);
  head.push("    models:");
  for (const m of p.models) head.push(`      - id: ${m}`, `        name: ${m}`);
  return head.join("\n");
}

/** 把新 provider 块插进原文(纯函数,可测):
 *  有 providers: → 插其块尾;无该键 → 原文尾补键;空文 → 全新文件。 */
export function insertProvider(raw: string, p: OmpCustomProviderInput): string {
  const block = buildProviderBlock(p);
  if (!raw.trim()) return `providers:\n${block}\n`;
  const lines = raw.split("\n");
  const at = lines.findIndex((l) => /^providers:\s*$/.test(l));
  if (at < 0) return `${raw.replace(/\n+$/, "")}\n\nproviders:\n${block}\n`;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(end, 0, block);
  return lines.join("\n");
}

/** GUI 添加:读原文 → 校验 → 插入 → 备份 → 覆盖写。 */
export async function addOmpCustomProvider(input: OmpCustomProviderInput): Promise<void> {
  const cfg = await readOmpModelsConfig();
  const valid = validateProviderInput(input, cfg.providers.map((p) => p.name));
  const next = insertProvider(cfg.raw, valid);
  await saveOmpModelsConfig(next);
}
