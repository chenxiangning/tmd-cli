import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";

const STATUS_TAIL_BYTES = 256 * 1024;

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
      if (event.type === "model_change" && (!model || !provider)) {
        if (!provider) {
          for (const key of providerKeys) {
            const value = event[key];
            provider = typeof value === "string" && value.length > 0 ? value : undefined;
            if (provider) break;
          }
        }
        if (!model) {
          for (const key of modelKeys) {
            const value = event[key];
            model = typeof value === "string" && value.length > 0 ? value : undefined;
            if (model) break;
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


