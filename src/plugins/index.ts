/**
 * 插件清单 —— 内核唯一感知插件存在的地方。
 * 新增插件 = 在此数组加一行（编译期注册 + 运行期激活）。
 */

import type { Plugin } from "@kernel/plugin";
import { cliCodexPlugin } from "./cli-codex";
import { cliOmpPlugin } from "./cli-omp";
import { cliPiPlugin } from "./cli-pi";
import { composerPlugin } from "./composer";
import { filesPlugin } from "./files";
import { gitPlugin } from "./git";
import { workspacePlugin } from "./workspace";

export const allPlugins: Plugin[] = [
  cliOmpPlugin,
  cliPiPlugin,
  cliCodexPlugin,
  workspacePlugin,
  filesPlugin,
  gitPlugin,
  composerPlugin,
];
