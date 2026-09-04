/**
 * omp 命令/技能真相查询 ── `omp --mode rpc --no-session` 副车 + get_available_commands。
 *
 * 2026-09-04 实测(omp 18.1.6):响应 data.commands[] = {name, description,
 * input.hint, subcommands[]};技能以 `skill:` 名字前缀混在同一响应里;
 * TUI 专属命令不在其中(静态表保留)。stdin 立即 EOF 会丢响应,收割语义见
 * cli-shared/cliQuery(持开管道 + 唯一 id 提前收割)。
 */

import type { CliSuggestion, TriggerKind } from "@kernel/cli";
import { CachedCliQuery, queryCliRpc } from "../cli-shared/cliQuery";

interface OmpCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
  subcommands?: Array<{ name: string; description?: string }>;
}

/** 技能名前缀:omp 原生语法 /skill:<name>,composer 侧按契约存裸名、发送时翻译。 */
const SKILL_PREFIX = "skill:";

async function fetchOmpCommands(cwd: string): Promise<Map<TriggerKind, CliSuggestion[]> | null> {
  const response = await queryCliRpc(
    { command: "omp", args: ["--mode", "rpc", "--no-session"], cwd },
    { type: "get_available_commands" },
  );
  const data = response?.data as { commands?: OmpCommand[] } | undefined;
  if (response?.success !== true || !Array.isArray(data?.commands)) return null;

  const byKind = new Map<TriggerKind, CliSuggestion[]>([
    ["command", []],
    ["skill", []],
  ]);
  for (const cmd of data.commands) {
    const skill = cmd.name.startsWith(SKILL_PREFIX);
    const hint = cmd.input?.hint ? ` · ${cmd.input.hint}` : "";
    const item: CliSuggestion = {
      value: skill ? cmd.name.slice(SKILL_PREFIX.length) : cmd.name,
      description: [cmd.description, hint].filter(Boolean).join("") || undefined,
      action: "insert",
    };
    byKind.get(skill ? "skill" : "command")?.push(item);
  }
  return byKind;
}

const cached = new CachedCliQuery(fetchOmpCommands, 5 * 60_000);

/**
 * listSuggestions 契约实现(omp profile)。
 * 副车不可达/超时 = null → 内核与 composer 回退静态表。
 */
export async function listOmpSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  const byKind = await cached.get(cwd);
  return byKind?.get(kind) ?? null;
}

/** 测试 seam:绕过 TTL 缓存直测 fetch 映射与失败语义。 */
export const _fetchOmpCommandsForTest = fetchOmpCommands;

