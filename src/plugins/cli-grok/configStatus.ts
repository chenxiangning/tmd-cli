/**
 * grok 默认状态 ── 创建即赋值的数据源。
 *
 * 磁盘真相与 TOML 解析见 cli-shared/grokConfig.ts(与 welcome 凭据盘点共用);
 * 本模块只做 CliSessionStatus 映射 + IO 壳。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";
import { resolveGrokDefaultProfile } from "../cli-shared/grokConfig";

/** 纯解析:config.toml 文本 → 默认模型/思考强度。 */
export function parseGrokConfigStatus(configToml: string): CliSessionStatus {
  const profile = resolveGrokDefaultProfile(configToml);
  return profile.reasoningEffort
    ? { model: profile.model, thinkingLevel: profile.reasoningEffort }
    : { model: profile.model };
}

/** IO 薄壳:读 ~/.grok/config.toml;读不到 = null(不猜)。 */
export async function readGrokDefaultStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const text = await ipc.fsReadFile(`${home}/.grok/config.toml`).catch(() => null);
  return text ? parseGrokConfigStatus(text) : null;
}
