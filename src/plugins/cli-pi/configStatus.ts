/**
 * pi 默认状态 ── 创建即赋值的数据源。
 *
 * 实证 ~/.pi/agent/settings.json:
 *   { "defaultProvider": "kimi-coding", "defaultModel": "k3", "defaultThinkingLevel": "high" }
 *
 * 模型显示格式与会话文件解析对齐:provider/model 限定名(例 kimi-coding/k3)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";
import { piAgentDir } from "./quota";

/** 纯解析:settings.json 对象 → 默认模型/思考强度;字段级类型守卫,不盲目断言。 */
export function parsePiSettingsStatus(settings: unknown): CliSessionStatus | null {
  if (!settings || typeof settings !== "object") return null;
  const map = settings as Record<string, unknown>; // typeof 已收窄为 object,字段逐一守卫
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const provider = str(map.defaultProvider);
  const bareModel = str(map.defaultModel);
  const thinkingLevel = str(map.defaultThinkingLevel);
  const model = provider && bareModel ? `${provider}/${bareModel}` : bareModel;
  if (!model && !thinkingLevel) return null;
  return { model, thinkingLevel };
}

/** IO 薄壳:读 <piAgentDir>/settings.json;读不到 = null(不猜)。 */
export async function readPiDefaultStatus(): Promise<CliSessionStatus | null> {
  const dir = await piAgentDir().catch(() => null);
  if (!dir) return null;
  const text = await ipc.fsReadFile(`${dir}/settings.json`).catch(() => null);
  if (!text) return null;
  try {
    return parsePiSettingsStatus(JSON.parse(text));
  } catch {
    return null;
  }
}
