import { readJsonlSessionStatus } from "../cli-shared/sessionStatus";
import { piAgentDir, registerPiQuotaProvider } from "./quota";
import { scanJsonlSessions } from "@kernel/diskSessions";
import type { CliDiskSession } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/** pi 品牌字形(codemoss EngineIcon 同源):π 方块组合,currentColor 随主题。 */
const PI_ICON_PATHS = [
  "M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z",
  "M17.5 12H23v11h-5.5V12z",
] as const;

function PiGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      {PI_ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * pi 磁盘会话存储(实证自 ~/.pi/agent/sessions/ 真实目录):
 * - 目录 = ~/.pi/agent/sessions/<slug>/<iso-ts>_<uuid>.jsonl
 * - slug 规则(与 omp 不同!): "--" + cwd 去前导斜杠后 "/" → "-" + "--"
 *   例 /Users/x/code/AI/github/tmd-cli → --Users-chenxiangning-...-tmd-cli--
 */
async function piSessionsDir(cwd: string): Promise<string | null> {
  const agentDir = await piAgentDir().catch(() => null);
  if (!agentDir) return null;
  const slug = `--${cwd.replace(/^\/+/, "").replace(/\//g, "-")}--`;
  return `${agentDir}/sessions/${slug}`;
}

async function listPiSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await piSessionsDir(cwd);
  if (!dir) return [];
  return scanJsonlSessions(dir);
}

async function readPiSessionStatus(cwd: string, cliSessionId: string) {
  const dir = await piSessionsDir(cwd);
  if (!dir) return null;
  return readJsonlSessionStatus(
    dir,
    cliSessionId,
    ["modelId", "model"],
    ["provider", "providerId"],
  );
}

/**
 * pi CLI 插件（CLI 能力矩阵调研结论）：
 * 与 omp 同宗 pi-tui 编辑器，`/` 与 `@` 原生支持；
 * skill 走 /skill:<name>，`$` 发送时翻译。
 * 会话恢复：--resume <uuid>；历史列表 = 扫 pi 自己的 jsonl 目录。
 */
export const cliPiPlugin: Plugin = {
  id: "cli-pi",
  activate(ctx) {
    // 注册 pi quota provider(按当前模型前缀路由供应商,HTTP 走共享 vendors)。
    registerPiQuotaProvider();
    ctx.registerCliProfile({
      id: "pi",
      name: "pi",
      renderIcon: (size) => <PiGlyph size={size} />,
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
      listSessions: listPiSessions,
      readSessionStatus: readPiSessionStatus,
    });
  },
};
