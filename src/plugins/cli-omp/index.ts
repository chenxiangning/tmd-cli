import type { Plugin } from "@kernel/plugin";
import { ipc } from "@kernel/ipc";

/**
 * omp session id 探测:
 * 文件路径 = ~/.omp/agent/sessions/<cwd-slug>/<iso-ts>_<uuid>.jsonl
 * cwd slug = 相对 home 目录,把 / 替换为 -(忽略前导 ~)。
 * uuid = 文件名 _ 之后到 .jsonl 之前的部分。
 */
async function detectOmpSessionId(cwd: string): Promise<string | null> {
  // 计算 slug:去掉 /Users/<name> 前缀,换 / 为 -
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const rel = cwd.startsWith(home) ? cwd.slice(home.length) : cwd;
  const slug = rel.replace(/\//g, "-");
  const dir = `${home}/.omp/agent/sessions/${slug}`;
  const name = await ipc.fsLatestFile(dir, ".jsonl").catch(() => null);
  if (!name) return null;
  // 2026-09-01T04-20-58-618Z_01a05b32-ea7a-738c-8a48-0d03dfef6824.jsonl
  const m = name.match(/_([0-9a-f-]{36})\.jsonl$/);
  return m?.[1] ?? null;
}

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
      suggestions: {
        command: [
          { value: "help", description: "查看可用命令" },
          { value: "clear", description: "清屏" },
          { value: "model", description: "查看/切换模型" },
        ],
        skill: [
          { value: "think", description: "深度思考模式" },
          { value: "plan", description: "只读规划模式" },
          { value: "review", description: "代码评审" },
        ],
      },
      resumeArgs: (sessionId) => ["--resume", sessionId],
      detectCliSessionId: detectOmpSessionId,
    });
  },
};
