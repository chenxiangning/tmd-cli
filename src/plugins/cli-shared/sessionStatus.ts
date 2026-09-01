import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";

const STATUS_TAIL_BYTES = 256 * 1024;
/** 模型 id 裸名(去 provider/ 前缀),用于跨事件确认同一模型。 */
function bareModelId(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
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
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  const file = files.find((entry) => entry.name.includes(cliSessionId));
  if (!file) return null;

  const tail = await ipc.fsReadTail(file.path, STATUS_TAIL_BYTES).catch(() => "");
  if (!tail) return null;

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


