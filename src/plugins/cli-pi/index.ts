import type { Plugin } from "@kernel/plugin";

/**
 * pi CLI 插件（CLI 能力矩阵调研结论）：
 * 与 omp 同宗 pi-tui 编辑器，`/` 与 `@` 原生支持；
 * skill 走 /skill:<name>，`$` 发送时翻译。
 */
export const cliPiPlugin: Plugin = {
  id: "cli-pi",
  activate(ctx) {
    ctx.registerCliProfile({
      id: "pi",
      name: "pi",
      command: "pi",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token) => `/skill:${token.replace(/^\$/, "")}`,
        },
      ],
      resumeArgs: (sessionId) => ["--resume", sessionId],
    });
  },
};
