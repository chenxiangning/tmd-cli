/**
 * 会话 JSONL 状态读取共享(pi 族适配器 piFamily 的内部件,经其服务 omp/pi):
 * 定位会话文件 → 尾窗读(256KB)→ 模型/供应商字段探测(字段键由各家声明)。
 * 准入先例:piFamily(omp/pi);解析与 IPC 均无单插件语义。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";

const STATUS_TAIL_BYTES = 256 * 1024;
/** 模型 id 裸名(去 provider/ 前缀),用于跨事件确认同一模型。 */
function bareModelId(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * 状态巡航尺寸闸:path → 上次尺寸与解析产物。会话日志 append-only,尺寸未变 =
 * 内容未变 → 返回同解析产物,巡航拍免列目录免读免解析(提案
 * openspec/changes/2026-09-18-perf-status-poll,含方案取舍与老功能校准矩阵)。
 * 同尺寸原地替换不属于任何 CLI 会话日志的写行为(resume 另起新文件,闸键随
 * cliSessionId 自然失效)。只存解析产物不存尾窗文本,单条 ~200B 不设上限。
 * 例外:codex resume/fork 产生**同 id 新文件**(闸键不变)且旧文件不再写,
 * 黏滞 path 会永久短路 → revalidateMs 到期强制重定位一次(30s 级自愈)。
 */
const tailGate = new Map<
  string,
  { path: string; size: number; result: CliSessionStatus | null; resolvedAt: number }
>();

/** 闸短路探测:上次尺寸未变 → true。探测失败(文件被移走等)按未命中处理,调用方走全路径自愈。 */
async function gateShortCircuit(path: string, lastSize: number): Promise<boolean> {
  try {
    const probe = await ipc.fsReadTailChanged(path, 0, lastSize);
    return !probe.changed;
  } catch {
    return false;
  }
}

export async function readStatusTailGated(
  key: string,
  resolvePath: () => Promise<string | null>,
  maxBytes: number,
  parse: (text: string) => CliSessionStatus | null,
  /** 路径重定位周期(默认永不):目录扫描定位型(codex 同 id 多文件取最新)必传,
   *  防止 resume 后黏滞旧 path 永久短路(直拼路径型无需)。 */
  revalidateMs = Number.POSITIVE_INFINITY,
): Promise<CliSessionStatus | null> {
  const cached = tailGate.get(key);
  const fresh = cached !== undefined && Date.now() - cached.resolvedAt < revalidateMs;
  if (cached && fresh && (await gateShortCircuit(cached.path, cached.size))) return cached.result;

  const path = await resolvePath();
  if (!path) {
    tailGate.delete(key);
    return null;
  }
  const tail = await ipc.fsReadTailChanged(path, maxBytes, null).catch(() => null);
  if (!tail) return null;
  const result = tail.text ? parse(tail.text) : null;
  tailGate.set(key, { path, size: tail.size, result, resolvedAt: Date.now() });
  return result;
}

/**
 * 读取 omp/pi 共享 JSONL session 格式中的最后状态事件。
 * 文件名包含 CLI session id,目录扫描结果已按 mtime 倒序。
 */
export async function readJsonlSessionStatus(
  dir: string,
  cliSessionId: string,
  modelKeys: readonly string[],
  providerKeys: readonly string[] = [],
): Promise<CliSessionStatus | null> {
  return readStatusTailGated(
    `${dir}\u0000${cliSessionId}`,
    async () => {
      /* omp/pi 共享全局会话目录,一拍 = 全目录 stat 排序;闸命中时此步整段免掉 */
      const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
      return files.find((entry) => entry.name.includes(cliSessionId))?.path ?? null;
    },
    STATUS_TAIL_BYTES,
    (text) => parseJsonlStatusTail(text, modelKeys, providerKeys),
  );
}

/** 尾窗文本 → 模型/思考强度(内容级解析,本地读与远程读取共用)。 */
export function parseJsonlStatusTail(
  tail: string,
  modelKeys: readonly string[],
  providerKeys: readonly string[] = [],
): CliSessionStatus | null {
  let model: string | undefined;
  let provider: string | undefined;
  let thinkingLevel: string | undefined;
  for (const line of tail.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "thinking_level_change" && !thinkingLevel) {
        const value = event.thinkingLevel;
        if (typeof value === "string" && value.length > 0) thinkingLevel = value;
      }
      /*
       * assistant 消息也是模型信号:omp/pi 在 resume 等路径恢复模型时
       * 不落 model_change,只有 message.message 记录真实生效的 model/provider。
       * 倒序首遇 = 文件中最新,天然优先于更早的 model_change。
       */
      if (event.type === "message" && !model) {
        const message = event.message as Record<string, unknown> | undefined;
        if (message?.role === "assistant") {
          const value = message.model;
          if (typeof value === "string" && value.length > 0) {
            model = value;
            const p = message.provider;
            if (typeof p === "string" && p.length > 0) provider = p;
          }
        }
      }
      if (event.type === "model_change" && (!model || !provider)) {
        let changeModel: string | undefined;
        for (const key of modelKeys) {
          const value = event[key];
          changeModel = typeof value === "string" && value.length > 0 ? value : undefined;
          if (changeModel) break;
        }
        if (!model) {
          model = changeModel;
          if (!provider) {
            for (const key of providerKeys) {
              const value = event[key];
              provider = typeof value === "string" && value.length > 0 ? value : undefined;
              if (provider) break;
            }
          }
        } else if (changeModel && bareModelId(changeModel) === bareModelId(model)) {
          /*
           * model 来自更新的 message(裸 id)时,仅当该 model_change 是同一模型
           * 才采信其全名/前缀;不同模型的旧事件不得张冠李戴。
           */
          if (!model.includes("/") && changeModel.includes("/")) model = changeModel;
          if (!provider) {
            for (const key of providerKeys) {
              const value = event[key];
              provider = typeof value === "string" && value.length > 0 ? value : undefined;
              if (provider) break;
            }
          }
        }
      }
      if (model && (provider || providerKeys.length === 0) && thinkingLevel) break;
    } catch {
      // 尾部首行可能是截断 JSON,忽略后继续读取完整行。
    }
  }

  const qualifiedModel =
    provider && model && !model.includes("/") ? `${provider}/${model}` : model;
  return qualifiedModel || thinkingLevel
    ? { model: qualifiedModel, thinkingLevel }
    : null;
}


