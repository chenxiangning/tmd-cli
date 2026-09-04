import { piSessionsDir, readPiSessionEdits } from "./edits";
import { readJsonlSessionStatus } from "../cli-shared/sessionStatus";
import { parsePiFamilySessionHead } from "../cli-shared/sessionIdentity";
import { ipc } from "@kernel/ipc";
import {
  findJsonlSessionFile,
  ompPiUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { readPiDefaultStatus } from "./configStatus";
import { registerPiQuotaProvider } from "./quota";
import { scanJsonlSessions } from "../cli-shared/diskSessions";
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
 * pi 磁盘会话目录与写入事件适配器在 ./edits.ts(审批线 events 归因第二信号源),
 * slug 规则随实现注释走,此处只消费。
 */

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

/** 身份自证:头部 {"type":"session","id","cwd","timestamp"} 行(与 omp 同族,共享解析)。 */
async function readPiSessionIdentity(path: string) {
  const head = await ipc.fsReadHead(path, 4 * 1024).catch(() => null);
  return head ? parsePiFamilySessionHead(head) : null;
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
      readSessionFileIdentity: readPiSessionIdentity,
      readDefaultStatus: readPiDefaultStatus,
      readSessionUserMessages: readPiUserMessages,
      readSessionEdits: readPiSessionEdits,
    });
  },
};
