import { ClaudeGlyph } from "../cli-shared/engineGlyphs";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  claudeUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { parseClaudeFamilySessionHead } from "../cli-shared/sessionIdentity";
import type { CliProfile, CliSessionStatus, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { fetchClaudeQuota } from "./quota";
import { listClaudeSuggestions } from "./scanSuggestions";
import { claudeConfigEntry } from "./configGui";
import { applyClaudeChannel } from "./channelApply";
import { claudeSessionsDir, listClaudeSessions } from "./sessions";
import { ProviderChannelsCard } from "@plugins/cli-shared/providerChannels";
import { readStatusTailGated } from "../cli-shared/sessionStatus";
import { isJsonlSessionEmpty } from "../cli-shared/sessionEmpty";
/* 磁盘会话扫描/目录布局在 ./sessions(叶子模块,移动端 home 历史同源复用)。 */


const STATUS_TAIL_BYTES = 256 * 1024;

/**
 * 从会话文件尾部提取当前模型(纯函数,可测)。
 * claude jsonl 行型实证:assistant 行的 message.model 是真相;倒序找最后一帧。
 * user/queue-operation 行无 model 字段,天然被 type 守卫排除。
 */
export function extractClaudeModel(tail: string): string | undefined {
  for (const line of tail.split("\n").reverse()) {
    if (!line.includes('"model"')) continue;
    try {
      // 外部 JSON 逐层 in/typeof 收窄,不做 inline cast
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || !("type" in event)) continue;
      if (event.type !== "assistant" || !("message" in event)) continue;
      const message: unknown = event.message;
      if (!message || typeof message !== "object" || !("model" in message)) continue;
      const model: unknown = message.model;
      if (typeof model === "string" && model) return model;
    } catch {
      // 尾部块的首行可能被截断,跳过继续读完整行。
    }
  }
  return undefined;
}

async function readClaudeSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return null;
  /* claude 思考强度不落盘到会话文件(settings 全局开关),不提供 thinkingLevel。 */
  return readStatusTailGated(
    `${dir}\u0000${cliSessionId}`,
    async () => `${dir}/${cliSessionId}.jsonl`,
    STATUS_TAIL_BYTES,
    (tail) => {
      const model = extractClaudeModel(tail);
      return model ? { model } : null;
    },
  );
}
/** claude 文件名即会话 id,免扫目录直拼路径。 */
async function readClaudeUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return null;
  return readUserMessagesFromFile(`${dir}/${cliSessionId}.jsonl`, full, claudeUserMessageLine);
}

/** 身份自证:行内 sessionId/cwd 字段(claude 家族格式,与 qoder 共享解析)。 */
async function readClaudeSessionIdentity(path: string) {
  const head = await ipc.fsReadHead(path, 8 * 1024).catch(() => null);
  return head ? parseClaudeFamilySessionHead(head) : null;
}


/**
 * / 命令候选(官方 slash-commands 高频项;action 初判见
 * openspec/changes/composer-command-drawer/proposal.md,/model 类 picker 已拍板 send)。
 */
export const CLAUDE_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "查看可用命令", action: "send", icon: "help" },
  { value: "clear", description: "清空对话上下文", action: "send", icon: "clear" },
  { value: "compact", description: "压缩会话上下文(参数可选)", action: "send", icon: "compact" },
  { value: "model", description: "查看/切换模型(幕布内 picker)", action: "send", icon: "model" },
  { value: "usage", description: "查看额度用量", action: "send", icon: "usage" },
  { value: "resume", description: "恢复历史会话(幕布内 picker)", action: "send", icon: "resume" },
];

/**
 * MCP 配置真相 = ~/.claude.json 的 mcpServers(全局)+ projects.<cwd>.mcpServers(项目覆盖)。
 * 抽屉点击语义:send "/mcp"(管理入口;claude 的 MCP 服务器本身无 composer 引用语法)。
 * 纯函数可测;解析失败由调用方兜底为空。
 */
export function extractClaudeMcpServers(json: string, cwd: string): CliSuggestion[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  if (!root || typeof root !== "object" || !("mcpServers" in root)) return [];
  const byName = new Map<string, string>();
  const take = (obj: unknown, source: string) => {
    if (!obj || typeof obj !== "object") return;
    for (const name of Object.keys(obj)) {
      if (name) byName.set(name, source);
    }
  };
  take(root.mcpServers, "全局");
  if ("projects" in root && typeof root.projects === "object" && root.projects !== null) {
    for (const [projPath, proj] of Object.entries(root.projects)) {
      if (projPath !== cwd || !proj || typeof proj !== "object" || !("mcpServers" in proj)) continue;
      take(proj.mcpServers, "项目");
    }
  }
  return Array.from(byName, ([name, source]) => ({
    value: name,
    description: `MCP · ${t(source)}`,
    action: "send" as const,
    icon: "server",
    token: "/mcp ",
  }));
}

async function listClaudeMcpServers(cwd: string): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const json = await ipc.fsReadFile(`${home}/.claude.json`).catch(() => "");
  if (!json) return null;
  return extractClaudeMcpServers(json, cwd);
}
/**
 * 「AI 写入文件」输出标记(审批线 events 归因;实证 claude 2.1.x TUI):
 * - 工具行:`⏺ Update(file)` / `⏺ Write(file)` / `⏺ Edit(file)`(1.x 工具名,
 *   2.x 更名 Update —— 两个都收,旧版安装不缺事件)/ `⏺ NotebookEdit(file)`
 * - patch 头(工具结果区):`*** Update File: path` / `*** Add File: path` /
 *   `*** Delete File: path`(路径可为绝对,EditWatch 按会话 cwd 相对化)
 * 只收工具/patch 字面量,不收 Bash 行与助手正文(宁漏勿误 —— 手改混入
 * 批次比漏记更伤审批线可信度)。长路径截断(`…`)的行不匹配 → 漏报
 * 自愈为普通 dirty,不误报。
 */
const CLAUDE_EDIT_MARKS: RegExp[] = [
  /^\s*⏺\s+(?:Update|Write|Edit|NotebookEdit)\((.+)\)\s*$/,
  /^\s*\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$/,
];

/**
 * claude CLI 插件(CLI 能力矩阵 + 本机 2.1.251 实证):
 * - `/` 命令、`@` 文件引用:原生支持,纯透传。
 * - `$` skill:claude 原生语法是 /skill-name(--help: "Skills still resolve
 *   via /skill-name"),发送时翻译(同 omp 的 $→/skill: 方案)。
 * - 会话恢复:claude --resume <uuid>;历史列表 = 扫 claude 自己的 projects 目录。
 * - editMarks:审批线 events 归因(AI 写入事件流,见 CLAUDE_EDIT_MARKS)。
 */
export const cliClaudePlugin: Plugin = {
  id: "cli-claude",
  meta: {
    name: "Claude Code",
    abbr: "CC",
    desc: "Claude Code 引擎:项目会话、skill 提示",
    icon: ClaudeGlyph,
    category: "engine",
  },
  activate(ctx) {
    ctx.registerCliConfig({ ...claudeConfigEntry, icon: (size) => <ClaudeGlyph size={size} />, providerPanel: () => <ProviderChannelsCard engineId="claude" applyChannel={applyClaudeChannel} /> });
    /* 命令/技能真相:listSuggestions 磁盘扫描(commands/*.md + SKILL.md +
       插件缓存,项目级优先),静态内置表兜底 —— 不再 activate 时 hydrate。 */
    const profile: CliProfile = {
      id: "claude",
      fetchQuota: fetchClaudeQuota,
      docsUrl: "https://code.claude.com/docs/en/cli-reference",
      // npm 包仅用于 registry 最新版查询;安装走下方官方脚本通道。
      npmPackage: "@anthropic-ai/claude-code",
      scriptInstall: {
        unix: "curl -fsSL https://claude.ai/install.sh | bash",
        windows: "irm https://claude.ai/install.ps1 | iex",
      },
      name: "claude",
      renderIcon: (size) => <ClaudeGlyph size={size} />,
      command: "claude",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token) => `/${token.replace(/^\$/, "")}`,
        },
      ],
      suggestions: {
        command: CLAUDE_COMMAND_SUGGESTIONS,
        skill: [],
      },
      listSuggestions: listClaudeSuggestions,
      listMcpServers: listClaudeMcpServers,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listClaudeSessions,
      /* 会话卫生判空:path 即 <uuid>.jsonl,共享标记子串判定(sessionEmpty.ts) */
      isDiskSessionEmpty: (session) => isJsonlSessionEmpty(session.path),
      readSessionStatus: readClaudeSessionStatus,
      readSessionFileIdentity: readClaudeSessionIdentity,
      readSessionUserMessages: readClaudeUserMessages,
      editMarks: CLAUDE_EDIT_MARKS,
    };
    ctx.registerCliProfile(profile);
  },
};
