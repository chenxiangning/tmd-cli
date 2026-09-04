/**
 * pi 命令/技能真相查询 ── `pi --mode rpc --no-session --offline` 副车 + get_commands。
 *
 * 2026-09-04 实测(pi 0.84.4):data.commands[] = {name, description, source,
 * path};source ∈ extension(扩展注册命令)/ prompt(模板 .md)/ skill(技能,
 * 名字带 `skill:` 前缀)。内置 TUI 命令不在其中(静态表保留)。--offline 跳过
 * 启动网络动作(--no-session 不落会话),get_commands 不依赖模型目录。
 */

import type { CliSuggestion, TriggerKind } from "@kernel/cli";
import { CachedCliQuery, queryCliRpc } from "../cli-shared/cliQuery";

interface PiCommand {
  name: string;
  description?: string;
  source?: "extension" | "prompt" | "skill";
}

/** 技能名前缀:pi 原生语法 /skill:<name>,composer 侧存裸名、发送时翻译。 */
const SKILL_PREFIX = "skill:";

async function fetchPiCommands(cwd: string): Promise<Map<TriggerKind, CliSuggestion[]> | null> {
  const response = await queryCliRpc(
    {
      command: "pi",
      args: ["--mode", "rpc", "--no-session", "--offline"],
      cwd,
    },
    { type: "get_commands" },
  );
  const data = response?.data as { commands?: PiCommand[] } | undefined;
  if (response?.success !== true || !Array.isArray(data?.commands)) return null;

  const byKind = new Map<TriggerKind, CliSuggestion[]>([
    ["command", []],
    ["skill", []],
  ]);
  for (const cmd of data.commands) {
    const skill = cmd.name.startsWith(SKILL_PREFIX);
    byKind.get(skill ? "skill" : "command")?.push({
      value: skill ? cmd.name.slice(SKILL_PREFIX.length) : cmd.name,
      description: cmd.description,
      action: "insert",
    });
  }

  return byKind;
}

/** 测试 seam:绕过 TTL 缓存直测 fetch 映射与失败语义。 */
export const _fetchPiCommandsForTest = fetchPiCommands;

const cached = new CachedCliQuery(fetchPiCommands, 5 * 60_000);

/**
 * listSuggestions 契约实现(pi profile)。
 * 副车不可达/超时 = null → 内核与 composer 回退静态表。
 */
export async function listPiSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  const byKind = await cached.get(cwd);
  return byKind?.get(kind) ?? null;
}
