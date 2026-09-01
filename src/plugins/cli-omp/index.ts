import type { Plugin } from "@kernel/plugin";

/**
 * omp CLI 插件（CLI 能力矩阵调研结论）：
 * - `/` = 通用命令、`@` = 文件引用：原生支持，纯透传
 * - `$` = skill：omp 原生语法是 /skill:<name>，发送时翻译（方案 2）
 * - 会话恢复：-c / --resume（接入 session resume 时启用）
 */
export const cliOmpPlugin: Plugin = {
  id: "cli-omp",
  activate(ctx) {
    ctx.registerCliProfile({
      id: "omp",
      name: "omp",
      command: "omp",
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
