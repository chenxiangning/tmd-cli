/**
 * Codex 渠道应用 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 三段写盘:
 *   1) config.toml 顶层 model / model_provider,有 baseUrl 时 upsert 托管段
 *      [model_providers.tmd_channel](name + base_url),复用 cli-codex/configGui 的
 *      setToml(导出后共用);
 *   2) 任意一步抛错 → 从 .bak-tmd 恢复已写过的文件,整体回滚(backup.ts 共享壳);
 *   3) auth.json 合并 OPENAI_API_KEY(已有键覆盖);不存在 → 创建空对象。
 *
 * 全空 channel = no-op 成功(写不写盘,沿 saveClaudeConfig 同策略,config.toml 不变即跳过)。
 */

import { ipc } from "@kernel/ipc";
import { backupOnce, restoreFromBackup } from "@plugins/cli-shared/providerChannels";
import type { Channel } from "@plugins/cli-shared/providerChannels";
import { setToml } from "./configGui";

const CONFIG = ".codex/config.toml";
const AUTH = ".codex/auth.json";
const PROVIDER_NAME = "tmd_channel";

export async function applyCodexChannel(channel: Channel): Promise<void> {
  const home = await ipc.configHomeDir();
  const configPath = `${home}/${CONFIG}`;
  const authPath = `${home}/${AUTH}`;

  const [beforeConfig, beforeAuth] = await Promise.all([
    ipc.fsReadFile(configPath).catch(() => ""),
    ipc.fsReadFile(authPath).catch(() => ""),
  ]);

  const written: string[] = [];

  try {
    if (channel.model || channel.baseUrl) {
      const next = applyToml(beforeConfig, channel);
      if (next !== beforeConfig) {
        await backupOnce(configPath);
        await ipc.fsWriteFile(configPath, next);
        written.push(configPath);
      }
    }
    if (channel.apiKey?.trim()) {
      const next = applyAuth(beforeAuth, channel.apiKey.trim());
      if (next !== beforeAuth) {
        await backupOnce(authPath);
        await ipc.fsWriteFile(authPath, next);
        written.push(authPath);
      }
    }
  } catch (e) {
    /* 回滚并行:各文件从自身 .bak-tmd 恢复,互不依赖,无顺序语义 */
    await Promise.all(written.map((p) => restoreFromBackup(p)));
    throw e;
  }
}

function applyToml(raw: string, channel: Channel): string {
  let lines = raw.split("\n");
  if (channel.model?.trim()) lines = setToml(lines, "model", channel.model.trim());
  if (channel.baseUrl?.trim()) {
    lines = setToml(lines, "model_provider", PROVIDER_NAME);
    lines = upsertProviderSection(lines, channel);
  }
  return lines.join("\n");
}

/** 始终用 "tmd_channel" 段名,占位避免与用户已有 [model_providers.*] 冲突。 */
function upsertProviderSection(lines: string[], channel: Channel): string[] {
  const header = `[model_providers.${PROVIDER_NAME}]`;
  const start = lines.findIndex((l) => l.trim() === header);
  const block: string[] = [
    header,
    `name = ${JSON.stringify(channel.name || PROVIDER_NAME)}`,
    `base_url = ${JSON.stringify(channel.baseUrl!.trim())}`,
  ];
  if (start < 0) {
    const insertAt = lines.length;
    return [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)];
  }
  // 段存在 → 替换整段直到下一个 [section] 头;name/base_url 覆盖,其余键保留。
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const kept: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const k = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (k && (k[1] === "name" || k[1] === "base_url")) continue;
    kept.push(lines[i]);
  }
  return [...lines.slice(0, start), ...block, ...kept, ...lines.slice(end)];
}

function applyAuth(raw: string, apiKey: string): string {
  const trimmed = raw.trim();
  let obj: Record<string, unknown> = {};
  if (trimmed) {
    let v: unknown;
    try { v = JSON.parse(trimmed); } catch { v = null; }
    if (v && typeof v === "object" && !Array.isArray(v)) obj = v as Record<string, unknown>;
  }
  obj.OPENAI_API_KEY = apiKey;
  return JSON.stringify(obj, null, 2) + "\n";
}

/** 仅供单测(纯函数,无 IO);运行时无副作用。 */
export const __test_only = { applyToml, applyAuth, upsertProviderSection };
