import { readJsonlSessionStatus } from "../cli-shared/sessionStatus";
import {
  findJsonlSessionFile,
  ompPiUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { readPiDefaultStatus } from "./configStatus";
import { piAgentDir, registerPiQuotaProvider } from "./quota";
import { scanJsonlSessions } from "@kernel/diskSessions";
import type { CliDiskSession, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * pi 命令/技能候选(action 初判见 openspec/changes/composer-command-drawer)。
 * 技能注入后通常要跟任务文本 → 默认 insert。
 */
export const PI_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "查看可用命令", action: "send", icon: "help" },
  { value: "clear", description: "清屏", action: "send", icon: "clear" },
];

export const PI_SKILL_SUGGESTIONS: CliSuggestion[] = [
  { value: "think", description: "深度思考", icon: "think" },
  { value: "code", description: "代码任务", icon: "review" },
];

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
  /* 分隔符归一:Windows cwd 是反斜杠形态,不归一则 slug 永不失配。
     slug 规则本身不变:去前导斜杠 → 分隔符转 "-"。 */
  const cwdNorm = cwd.replace(/\\/g, "/");
  const slug = `--${cwdNorm.replace(/^\/+/, "").replace(/\//g, "-")}--`;
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

async function readPiUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const dir = await piSessionsDir(cwd);
  if (!dir) return null;
  const path = await findJsonlSessionFile(dir, cliSessionId);
  if (!path) return null;
  return readUserMessagesFromFile(path, full, ompPiUserMessageLine);
}

/**
 * pi CLI 插件（CLI 能力矩阵调研结论）：
 * 与 omp 同宗 pi-tui 编辑器，`/` 与 `@` 原生支持；
 * skill 走 /skill:<name>，`$` 发送时翻译。
 * 会话恢复：--resume <uuid>；历史列表 = 扫 pi 自己的 jsonl 目录。
 */
export const cliPiPlugin: Plugin = {
  id: "cli-pi",
  meta: { name: "Pi", abbr: "PI", desc: "Pi CLI 引擎:会话扫描、配额、状态", icon: PiGlyph, category: "engine" },
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
        command: PI_COMMAND_SUGGESTIONS,
        skill: PI_SKILL_SUGGESTIONS,
      },
      resumeArgs: (sessionId) => ["--resume", sessionId],
      /* pi 与 kimi 同源 pi-tui:编辑器原生解析 ESC[200~ 粘贴标记;声明后 composer
         发送走 bracketed paste,避开新版 TUI 的粘贴爆发回车吞没(见 kernel/cli.ts) */
      bracketedPaste: true,
      listSessions: listPiSessions,
      readSessionStatus: readPiSessionStatus,
      readDefaultStatus: readPiDefaultStatus,
      readSessionUserMessages: readPiUserMessages,
    });
  },
};
