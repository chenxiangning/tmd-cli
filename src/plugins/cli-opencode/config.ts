/**
 * opencode 配置文件知识 —— opencode.json 的路径与字段集中地。
 *
 * 布局(官方 config 文档 + 本机实读,2026-09-05):
 * - 全局:$XDG_CONFIG_HOME(缺省 ~/.config)/opencode/opencode.json
 * - 项目:<cwd>/.opencode/opencode.json;同名键项目覆盖全局,mcp/command 映射按键合并;
 * - 消费字段:model(默认模型 "provider/model")、mcp(服务器表)、command(JSON 自定义命令)。
 *
 * 经内核通用原语 fsReadFile 读取;路径/字段知识在插件侧,内核零感知。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";

/** opencode.json 中本插件消费的字段子集(其余键透传忽略)。 */
export interface OpencodeConfig {
  model?: string;
  mcp?: Record<string, Record<string, unknown>>;
  command?: Record<string, Record<string, unknown>>;
}

/* 经 cli-shared 消费 opencode 磁盘布局(合法通道,准入先例见其文件头)。 */
import { opencodeConfigDir } from "../cli-shared/opencodeDisk";

/** 单文件读取:不存在/损坏 = null(不抛)。 */
async function readConfigFile(path: string): Promise<OpencodeConfig | null> {
  const raw = await ipc.fsReadFile(path).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as OpencodeConfig) : null;
  } catch {
    return null;
  }
}

/** 收窄对象字段:非对象返回 undefined(顶层可能是异型)。 */
function objField<T extends Record<string, Record<string, unknown>>>(
  v: unknown,
): T | undefined {
  if (!v || typeof v !== "object") return undefined;
  return v as T;
}

/**
 * 全局 + 项目配置合并(纯函数,可测):顶层标量项目覆盖全局,
 * mcp/command 映射按键合并(项目同名服务器/命令覆盖全局)。
 */
export function mergeOpencodeConfig(
  global: OpencodeConfig | null,
  project: OpencodeConfig | null,
): OpencodeConfig {
  const merged: OpencodeConfig = {
    ...global,
    ...project,
  };
  const globalMcp = objField<NonNullable<OpencodeConfig["mcp"]>>(global?.mcp);
  const projectMcp = objField<NonNullable<OpencodeConfig["mcp"]>>(project?.mcp);
  const globalCommand = objField<NonNullable<OpencodeConfig["command"]>>(
    global?.command,
  );
  const projectCommand = objField<NonNullable<OpencodeConfig["command"]>>(
    project?.command,
  );
  if (globalMcp || projectMcp) merged.mcp = { ...globalMcp, ...projectMcp };
  if (globalCommand || projectCommand) merged.command = { ...globalCommand, ...projectCommand };
  return merged;
}

/** 读合并配置;两端都读不到 = null(默认模型/命令发现按能力缺失降级)。 */
export async function readOpencodeConfig(cwd: string): Promise<OpencodeConfig | null> {
  const dir = await opencodeConfigDir();
  const [global, project] = await Promise.all([
    dir ? readConfigFile(`${dir}/opencode.json`) : Promise.resolve(null),
    readConfigFile(`${cwd.replace(/\/$/, "")}/.opencode/opencode.json`),
  ]);
  if (!global && !project) return null;
  return mergeOpencodeConfig(global, project);
}

/** 默认模型(readDefaultStatus 数据源):"provider/model" 原样透传;缺失 = null。 */
export function opencodeDefaultModel(config: OpencodeConfig | null): string | null {
  return typeof config?.model === "string" && config.model ? config.model : null;
}

/** mcp 表 → 抽屉 MCP 分区候选(纯函数,可测)。展示名 + 类型/启停态;insert 插入名字供会话引用。 */
export function opencodeMcpSuggestions(config: OpencodeConfig | null): CliSuggestion[] {
  const mcp = objField<NonNullable<OpencodeConfig["mcp"]>>(config?.mcp);
  if (!mcp) return [];
  return Object.entries(mcp).map(([name, entry]) => {
    const type = typeof entry?.type === "string" ? entry.type : "local";
    const disabled = entry?.enabled === false;
    return {
      value: name,
      description: `MCP ${type}${disabled ? " · 已停用" : ""}`,
      action: "insert" as const,
      icon: "server",
    };
  });
}

/** command 表(JSON 自定义命令)→ 命令候选(纯函数,可测);template 必填缺失项跳过。 */
export function opencodeJsonCommandSuggestions(config: OpencodeConfig | null): CliSuggestion[] {
  const command = objField<NonNullable<OpencodeConfig["command"]>>(config?.command);
  if (!command) return [];
  const out: CliSuggestion[] = [];
  for (const [name, entry] of Object.entries(command)) {
    if (typeof entry?.template !== "string" || !entry.template) continue;
    const description =
      typeof entry.description === "string" && entry.description ? entry.description : undefined;
    out.push({ value: name, description, action: "insert" });
  }
  return out;
}
