/**
 * omp 命令/技能真相查询 ── `omp --mode rpc --no-session` 副车 + get_available_commands。
 *
 * 2026-09-04 实测(omp 18.1.6):响应 data.commands[] = {name, description,
 * input.hint, subcommands[]};技能以 `skill:` 名字前缀混在同一响应里;
 * TUI 专属命令不在其中(静态表保留)。前缀分流/缓存/切片走
 * cli-shared/cliQuery 的 createRpcSuggestionSource 工厂。
 */

import { createRpcSuggestionSource } from "../cli-shared/cliQuery";

const source = createRpcSuggestionSource({
  spawn: { command: "omp", args: ["--mode", "rpc", "--no-session"] },
  method: "get_available_commands",
  /* omp 特有:input.hint 以 " · " 拼进描述(键盘提示)。 */
  mapCommand: (cmd) => {
    const hint =
      typeof cmd.input === "object" && cmd.input !== null &&
      "hint" in cmd.input && typeof cmd.input.hint === "string"
        ? ` · ${cmd.input.hint}`
        : "";
    const description =
      typeof cmd.description === "string" ? cmd.description : "";
    return {
      name: typeof cmd.name === "string" ? cmd.name : "",
      description: description + hint || undefined,
    };
  },
});

/**
 * listSuggestions 契约实现(omp profile)。
 * 副车不可达/超时 = null → 内核与 composer 回退静态表。
 */
export const listOmpSuggestions = source.list;

/** 测试 seam:绕过 TTL 缓存直测 fetch 映射与失败语义。 */
export const _fetchOmpCommandsForTest = source.fetchForTest;
