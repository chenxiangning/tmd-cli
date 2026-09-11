/**
 * Claude Code 渠道应用 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 把 channel 摊平到 settings.json 的 env 三键(ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY /
 * ANTHROPIC_MODEL;cc-switch 导入条目的 ANTHROPIC_AUTH_TOKEN 已在导入时并入 apiKey 字段),
 * 复用 cli-claude/configGui 的 loadClaudeConfig + saveClaudeConfig 行级合并逻辑,零格式知识增。
 *
 * 语义:渠道未定义的字段 = 保留现状(model-only 渠道不清掉现有 endpoint/key;
 * 反向亦然,不产生跨渠道的陈旧凭据清洗)。写盘前走 backup.ts 备份壳(.bak-tmd,不滚存)。
 */

import { ipc } from "@kernel/ipc";
import { backupOnce } from "@plugins/cli-shared/providerChannels";
import { loadClaudeConfig, saveClaudeConfig } from "./configGui";
import type { Channel } from "@plugins/cli-shared/providerChannels";
import type { CliConfigValues } from "@kernel/cliConfigRegistry";

const SETTINGS = ".claude/settings.json";

/** 把 channel 三字段写进全局 settings.json;未定义字段保留原值。 */
export async function applyClaudeChannel(channel: Channel): Promise<void> {
  const home = await ipc.configHomeDir();
  const path = `${home}/${SETTINGS}`;
  const raw = await ipc.fsReadFile(path).catch(() => "");
  const current = loadClaudeConfig(raw);
  const base: CliConfigValues = {
    ...current,
    baseUrl: channel.baseUrl?.trim() || (current.baseUrl as string) || "",
    apiKey: channel.apiKey?.trim() || (current.apiKey as string) || "",
    envModel: channel.model?.trim() || (current.envModel as string) || "",
  };
  const next = saveClaudeConfig(raw, base);
  await backupOnce(path);
  await ipc.fsWriteFile(path, next);
}
