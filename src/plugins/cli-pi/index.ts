import type { Plugin } from "@kernel/plugin";
import { ipc } from "@kernel/ipc";

/**
 * pi session id 探测(与 omp 同宗):
 * ~/.omp/agent/sessions/<cwd-slug>/<iso-ts>_<uuid>.jsonl
 */
async function detectPiSessionId(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const rel = cwd.startsWith(home) ? cwd.slice(home.length) : cwd;
  const slug = rel.replace(/\//g, "-");
  const dir = `${home}/.omp/agent/sessions/${slug}`;
  const name = await ipc.fsLatestFile(dir, ".jsonl").catch(() => null);
  if (!name) return null;
  const m = name.match(/_([0-9a-f-]{36})\.jsonl$/);
  return m?.[1] ?? null;
}

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
      suggestions: {
        command: [
          { value: "help", description: "查看可用命令" },
          { value: "clear", description: "清屏" },
        ],
        skill: [
          { value: "think", description: "深度思考" },
          { value: "code", description: "代码任务" },
        ],
      },
      resumeArgs: (sessionId) => ["--resume", sessionId],
      detectCliSessionId: detectPiSessionId,
    });
  },
};
