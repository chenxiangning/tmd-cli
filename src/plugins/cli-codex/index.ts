import type { Plugin } from "@kernel/plugin";

/**
 * codex CLI 插件（CLI 能力矩阵调研结论）：
 * 三个触发符 `$` `/` `@` 全部原生支持，零翻译纯透传。
 * 会话恢复：codex resume <id>。
 */
export const cliCodexPlugin: Plugin = {
  id: "cli-codex",
  activate(ctx) {
    ctx.registerCliProfile({
      id: "codex",
      name: "codex",
      command: "codex",
      args: [],
      triggers: [
        { char: "$", kind: "skill" },
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
      ],
      resumeArgs: (sessionId) => ["resume", sessionId],
    });
  },
};
