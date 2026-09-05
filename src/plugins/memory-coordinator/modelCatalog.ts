/**
 * omp 模型目录 —— 引擎配置卡的数据拉取源。
 *
 * `omp models list --json`(PoC 向导同源):返回全部 provider 的模型
 * (selector/name/contextWindow/reasoning…),即安装向导「31 个模型选项」
 * 的同一数据面。失败(omp 缺席/超时)返回空,引擎卡降级为手动输入。
 */

import { ipc } from "@kernel/ipc";

export interface ModelEntry {
  selector: string;
  name: string;
  provider: string;
  contextWindow: number;
  reasoning: boolean;
}

export type ModelEngine = "omp" | "pi" | "opencode";

const cache = new Map<ModelEngine, ModelEntry[]>();
const cacheAt = new Map<ModelEngine, number>();

function fromCache(engine: ModelEngine): ModelEntry[] | null {
  const at = cacheAt.get(engine) ?? 0;
  if (Date.now() - at < 10 * 60 * 1000) return cache.get(engine) ?? null;
  return null;
}

/** 拉取指定引擎的可用模型(10 分钟缓存;失败/不支持返回空数组)。 */
export async function listModels(engine: ModelEngine = "omp", force = false): Promise<ModelEntry[]> {
  if (!force) {
    const hit = fromCache(engine);
    if (hit) return hit;
  }
  let entries: ModelEntry[] = [];
  try {
    if (engine === "omp") {
      const r = await ipc.procCommunicate({
        command: "omp",
        args: ["models", "list", "--json"],
        cwd: ".",
        timeoutMs: 30_000,
      });
      if (r.code === 0) {
        const parsed = JSON.parse(r.stdout) as { models?: Record<string, unknown>[] };
        entries = (parsed.models ?? []).map((m) => ({
          selector: String(m.selector ?? `${m.provider}/${m.id}`),
          name: String(m.name ?? m.id ?? ""),
          provider: String(m.provider ?? ""),
          contextWindow: Number(m.contextWindow ?? 0),
          reasoning: m.reasoning === true,
        }));
      }
    } else if (engine === "opencode") {
      // opencode models 无 --json:逐行 selector 文本
      const r = await ipc.procCommunicate({
        command: "opencode",
        args: ["models"],
        cwd: ".",
        timeoutMs: 30_000,
      });
      if (r.code === 0) {
        entries = r.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.includes("/"))
          .map((l) => ({ selector: l, name: l, provider: l.split("/")[0], contextWindow: 0, reasoning: false }));
      }
    }
    // pi:无非交互模型列表命令(模型在交互 /model 里选)→ 空,UI 降级手填
  } catch {
    entries = [];
  }
  cache.set(engine, entries);
  cacheAt.set(engine, Date.now());
  return entries;
}
