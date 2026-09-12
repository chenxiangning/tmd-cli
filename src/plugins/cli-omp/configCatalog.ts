/**
 * omp 模型目录装配:与配置文件解耦 —— 主源是 `omp models --json` 的登录实况矩阵
 * (procCommunicate 通用进程通道,异步),models.yml 已配置供应商作并集补充
 * (标「已配置」)。CLI 不可用时降级为 models.yml 单源。
 */
import { ipc } from "@kernel/ipc";
import type { CliModelCatalogProvider } from "@kernel/cliConfigRegistry";

const indentOf = (line: string): number => line.match(/^ */)?.[0].length ?? 0;

/**
 * models.yml → 供应商目录(行级状态机,只认 omp 的 2 空格形态):
 * providers 块下每个供应商收 name 与 models 条目的 id / name / thinkingLevelMap 键。
 */
export function parseModelCatalog(modelsYml: string): CliModelCatalogProvider[] {
  const lines = modelsYml.split("\n");
  const providers: CliModelCatalogProvider[] = [];
  let current: CliModelCatalogProvider | null = null;
  let model: { id: string; label?: string; suffixes?: string[] } | null = null;
  let inModels = false;
  let inThinkingMap = false;
  for (const line of lines) {
    const ind = indentOf(line);
    const body = line.trim();
    if (ind === 0) {
      current = null;
      model = null;
      inModels = false;
      continue;
    }
    if (ind === 2 && /^[\w-]+:\s*$/.test(body)) {
      current = { id: body.slice(0, -1), models: [], authed: true };
      providers.push(current);
      model = null;
      inModels = false;
      continue;
    }
    if (!current) continue;
    if (ind === 4 && body.startsWith("name:")) {
      current.label = body.slice(5).trim().replace(/^["']|["']$/g, "");
      continue;
    }
    if (ind === 4 && body === "models:") {
      inModels = true;
      continue;
    }
    if (ind === 4) {
      inModels = false;
      model = null;
      continue;
    }
    if (!inModels) continue;
    if (ind === 6 && body.startsWith("- id:")) {
      model = { id: body.slice(5).trim().replace(/^["']|["']$/g, "") };
      current.models.push(model);
      inThinkingMap = false;
      continue;
    }
    if (!model) continue;
    if (ind === 8 && body.startsWith("name:")) {
      model.label = body.slice(5).trim().replace(/^["']|["']$/g, "");
      inThinkingMap = false;
      continue;
    }
    if (ind === 8 && body === "thinkingLevelMap:") {
      inThinkingMap = true;
      continue;
    }
    if (inThinkingMap && ind === 10 && /^[\w-]+:/.test(body)) {
      (model.suffixes ??= []).push(body.slice(0, body.indexOf(":")));
      continue;
    }
    if (ind <= 8) inThinkingMap = false;
  }
  return providers.filter((p) => p.models.length > 0);
}

/** `omp models --json` 输出的单条模型(只取所需字段)。 */
interface OmpModelRow {
  provider?: string;
  id?: string;
  name?: string;
  thinking?: string[];
}

/**
 * `omp models --json` stdout → 供应商目录。
 * thinking 数组直接作思考强度候选(比 models.yml 的 thinkingLevelMap 更权威)。
 */
export function parseOmpModelsJson(stdout: string): CliModelCatalogProvider[] {
  let rows: OmpModelRow[];
  try {
    const parsed: unknown = JSON.parse(stdout);
    rows = Array.isArray((parsed as { models?: unknown[] }).models)
      ? ((parsed as { models: OmpModelRow[] }).models)
      : [];
  } catch {
    return [];
  }
  const byProvider = new Map<string, CliModelCatalogProvider>();
  for (const row of rows) {
    if (!row.provider || !row.id) continue;
    let provider = byProvider.get(row.provider);
    if (!provider) {
      provider = { id: row.provider, models: [], authed: true };
      byProvider.set(row.provider, provider);
    }
    provider.models.push({
      id: row.id,
      label: row.name && row.name !== row.id ? row.name : undefined,
      suffixes: row.thinking?.length ? row.thinking : undefined,
    });
  }
  return [...byProvider.values()];
}

/** 并集合并:CLI 实况为主(标 authed),仅存在于 models.yml 的供应商补入(标 badge)。 */
export function mergeCatalogs(
  cliProviders: CliModelCatalogProvider[],
  ymlProviders: CliModelCatalogProvider[],
): CliModelCatalogProvider[] {
  const merged = new Map<string, CliModelCatalogProvider>();
  for (const p of cliProviders) {
    merged.set(p.id, { ...p, models: [...p.models], badge: undefined });
  }
  for (const p of ymlProviders) {
    const hit = merged.get(p.id);
    if (!hit) {
      merged.set(p.id, { ...p, authed: false, badge: "已配置" });
      continue;
    }
    // 同供应商:yml 的 label 更友好(用户自定义 name),模型并集去重
    if (p.label && !hit.label) hit.label = p.label;
    const known = new Set(hit.models.map((m) => m.id));
    for (const m of p.models) if (!known.has(m.id)) hit.models.push(m);
  }
  return [...merged.values()];
}

let inflight: Promise<CliModelCatalogProvider[]> | null = null;

/**
 * 装配 omp 供应商目录(会话级缓存:面板打开一次,各字段共享同一 Promise;
 * 登录态变化在 app 重启/重新打开后自然刷新)。
 */
export function fetchOmpModelCatalog(): Promise<CliModelCatalogProvider[]> {
  inflight ??= (async () => {
    const home = await ipc.configHomeDir().catch(() => "");
    const [cliResult, ymlResult] = await Promise.allSettled([
      ipc.procCommunicate({
        command: "omp",
        args: ["models", "--json"],
        cwd: home || "/",
        closeStdin: true,
        timeoutMs: 20000,
      }),
      ipc.fsReadFile(`${home}/.omp/agent/models.yml`),
    ]);
    const cli =
      cliResult.status === "fulfilled" && cliResult.value.code === 0
        ? parseOmpModelsJson(cliResult.value.stdout)
        : [];
    const yml = ymlResult.status === "fulfilled" ? parseModelCatalog(ymlResult.value) : [];
    return mergeCatalogs(cli, yml);
  })().catch(() => {
    inflight = null; // 失败不缓存,下次打开重试
    return [];
  });
  return inflight;
}
