/**
 * pi 命令/技能真相查询 ── `pi --mode rpc --no-session --offline` 副车 + get_commands。
 *
 * 2026-09-04 实测(pi 0.84.4):data.commands[] = {name, description, source,
 * path};source ∈ extension(扩展注册命令)/ prompt(模板 .md)/ skill(技能,
 * 名字带 `skill:` 前缀)。内置 TUI 命令不在其中(静态表保留)。--offline 跳过
 * 启动网络动作(--no-session 不落会话),get_commands 不依赖模型目录。
 * 前缀分流/缓存/切片走 cli-shared/cliQuery 的 createRpcSuggestionSource 工厂。
 */

import { createRpcSuggestionSource } from "../cli-shared/cliQuery";

const source = createRpcSuggestionSource({
  spawn: {
    command: "pi",
    args: ["--mode", "rpc", "--no-session", "--offline"],
  },
  method: "get_commands",
  mapCommand: (cmd) => ({
    name: typeof cmd.name === "string" ? cmd.name : "",
    description: typeof cmd.description === "string" ? cmd.description : undefined,
  }),
});

/**
 * listSuggestions 契约实现(pi profile)。
 * 副车不可达/超时 = null → 内核与 composer 回退静态表。
 */
export const listPiSuggestions = source.list;

/** 测试 seam:绕过 TTL 缓存直测 fetch 映射与失败语义。 */
export const _fetchPiCommandsForTest = source.fetchForTest;
