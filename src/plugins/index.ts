/**
 * 插件清单 —— 内核唯一感知插件存在的地方。
 * 新增插件 = 在此数组加一行（编译期注册 + 运行期激活）。
 */

import type { Plugin } from "@kernel/plugin";
import { cliCodexPlugin } from "./cli-codex";
import { cliClaudePlugin } from "./cli-claude";
import { cliGrokPlugin } from "./cli-grok";
import { cliOmpPlugin } from "./cli-omp";
import { cliPiPlugin } from "./cli-pi";
import { cliKimiPlugin } from "./cli-kimi";
import { cliQoderPlugin } from "./cli-qoder";
import { cliQoderCnPlugin } from "./cli-qoder-cn";
import { cliOpencodePlugin } from "./cli-opencode";
import { composerPlugin } from "./composer";
import { filesPlugin } from "./files";
import { gitPlugin } from "./git";
import { sessionBudgetPlugin } from "./session-budget";
import { workspacePlugin } from "./workspace";
import { settingsPlugin } from "./settings";
import { sshPlugin } from "./ssh";
import { terminalPlugin } from "./terminal";
import { welcomePlugin } from "./welcome";
import { networkProxyPlugin } from "./network-proxy";
import { checkpointsPlugin } from "./checkpoints";
import { memoryCoordinatorPlugin } from "./memory-coordinator";

export const allPlugins: Plugin[] = [
  cliOmpPlugin,
  cliPiPlugin,
  cliKimiPlugin,
  cliCodexPlugin,
  cliClaudePlugin,
  cliGrokPlugin,
  cliQoderPlugin,
  cliQoderCnPlugin,
  cliOpencodePlugin,
  sessionBudgetPlugin,
  workspacePlugin,
  filesPlugin,
  gitPlugin,
  checkpointsPlugin,
  composerPlugin,
  settingsPlugin,
  networkProxyPlugin,
  sshPlugin,
  terminalPlugin,
  welcomePlugin,
  memoryCoordinatorPlugin,
];
