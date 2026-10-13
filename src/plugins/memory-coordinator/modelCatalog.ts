/**
 * 模型目录 —— 引擎配置卡/模型下拉的数据拉取单一真相源。
 * 消费方:memory-coordinator 引擎配置卡、feature 插件 workbench(概览默认引擎条、
 * journal 生成设置;声明先例,同 articleBody 消费 markdownBody 口径)。
 *
 * - omp:`omp models list --json`(PoC 向导同源),返回全部 provider 的模型
 *   (selector/name/contextWindow/reasoning…);失败(缺席/超时)返回空。
 * - pi:无非交互列表命令,实况目录消费 cli-pi 声明的 piModelCatalog
 *   (auth.json × models-store.json;feature 插件消费 cli-* 纯函数模块的
 *   声明先例,同 workbench 消费本件口径),selector = provider/modelId。
 * - opencode:`opencode models` 逐行 selector 文本。
 */

import { ipc } from "@kernel/ipc";
import { piModelCatalog } from "@plugins/cli-pi/configGui";

export interface ModelEntry {
  selector: string;
  name: string;
  provider: string;
  contextWindow: number;
  reasoning: boolean;
}

type ModelEngine = "omp" | "pi" | "opencode";
const MODEL_ENGINES: readonly ModelEngine[] = ["omp", "pi", "opencode"];

/** settings.memoryDistillEngine(kernel 存自由串)→ 可执行引擎;未知/空回落 omp。 */
export function resolveDistillEngine(raw: string): ModelEngine {
  return (MODEL_ENGINES as readonly string[]).includes(raw) ? (raw as ModelEngine) : "omp";
}

const cache = new Map<ModelEngine, ModelEntry[]>();
const cacheAt = new Map<ModelEngine, number>();

/** 测试缝:清空模块级缓存(模型目录缓存跨用例共享会串台)。 */
export function __resetModelCatalogForTests(): void {
  cache.clear();
  cacheAt.clear();
}

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
    } else if (engine === "pi") {
      /* 实况目录 = cli-pi 声明的 piModelCatalog(登录态排前已排序);pi --model
         接受 provider/modelId,与 pi 设置 defaultModel 同一 selector 形态。 */
      const providers = await piModelCatalog();
      entries = providers.flatMap((p) =>
        p.models.map((m) => ({
          selector: `${p.id}/${m.id}`,
          name: m.label || m.id,
          provider: p.id,
          contextWindow: 0,
          reasoning: false,
        })),
      );
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
  } catch {
    entries = [];
  }
  /* 只缓存非空结果:失败(引擎缺席/超时/未登录供应商)不进缓存,窗口期内恢复
     下次调用立即可重试;空结果不落缓存无进程开销。 */
  if (entries.length > 0) {
    cache.set(engine, entries);
    cacheAt.set(engine, Date.now());
  }
  return entries;
}
