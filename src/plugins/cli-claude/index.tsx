import { ipc } from "@kernel/ipc";
import {
  claudeUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { extractJsonlTitle } from "../cli-shared/diskSessions";
import { parseClaudeFamilySessionHead } from "../cli-shared/sessionIdentity";
import type { CliDiskSession, CliProfile, CliSessionStatus, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { registerClaudeQuotaProvider } from "./quota";

/**
 * claude 品牌 glyph:官方日芒标志(simple-icons claude 矢量路径 vendored,
 * 与 omp/codex glyph 同源策略),品牌橙 #D97757、viewBox 0 0 24 24 官方一致。
 */
const CLAUDE_ICON_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" as const;

function ClaudeGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#D97757"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path d={CLAUDE_ICON_PATH} />
    </svg>
  );
}

/**
 * claude 磁盘会话存储(实证自 ~/.claude/projects/ 真实目录,claude 2.1.251):
 * - 目录 = ~/.claude/projects/<slug>/<session-uuid>.jsonl(文件名即会话 id)
 * - slug 规则: cwd 中所有非 [a-zA-Z0-9] 字符逐一替换为 "-"
 *   例 /Users/x/code/AI/github/mossx → -Users-x-code-AI-github-mossx
 *   例 /Users/x/.claude → -Users-x--claude (点号同样替换)
 *   例 /Users/x/code/内容分析 → -Users-x-code----- (每个非 ASCII 字符一个 -)
 * - 目录本身即 cwd 分区,无需像 codex rollout 那样读文件头过滤。
 */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function claudeSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/.claude/projects/${claudeProjectSlug(cwd)}`;
}

async function listClaudeSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return [];
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of files) {
    // 6b844d1a-d84e-44c3-8385-1e1770d0ffb0.jsonl —— 文件名即 sessionId,直接喂 --resume
    const m = f.name.match(/^([0-9a-f-]{36})\.jsonl$/);
    if (!m) continue;
    /* claude 无 title 记录:summary 行或首条用户消息都在文件前段,32KB 窗口实证够用;
       目录本身已按 cwd 分区,每个文件都值得读头。 */
    const head = await ipc.fsReadHead(f.path, CLAUDE_TITLE_HEAD_BYTES).catch(() => "");
    const title = head ? extractJsonlTitle(head) : undefined;
    sessions.push({ id: m[1], modifiedAt: f.modifiedAt, path: f.path, title });
  }
  return sessions;
}

/** 标题提取的头部窗口:summary 行/首条用户消息前的 file-history-snapshot 可能膨胀,给足余量。 */
const CLAUDE_TITLE_HEAD_BYTES = 32 * 1024;

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
  const tail = await ipc
    .fsReadTail(`${dir}/${cliSessionId}.jsonl`, STATUS_TAIL_BYTES)
    .catch(() => "");
  if (!tail) return null;
  const model = extractClaudeModel(tail);
  // claude 思考强度不落盘到会话文件(settings 全局开关),不提供 thinkingLevel。
  return model ? { model } : null;
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
 * $ 触发符候选 = 用户真实安装的 skills(实证 ~/.claude/skills/<name>/SKILL.md,
 * 目录名即 skill 名)。omp/pi 用静态占位列表;claude 扫真实磁盘,不猜名字。
 * 仅扫 home 级(activate 时无 cwd,项目级 .claude/skills 留给 @ 文件触发)。
 * 读取失败 = 空候选,不阻塞激活。
 */
async function listClaudeSkillSuggestions(): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const entries = await ipc.fsListDir(`${home}/.claude/skills`).catch(() => []);
  return entries.filter((e) => e.isDir).map((e) => ({ value: e.name }));
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
    description: `MCP · ${source}`,
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
    // 注册 claude quota provider(settings.json env 凭据 → 供应商 HTTP 面)。
    registerClaudeQuotaProvider();
    /* 激活不等待 skills 扫盘(2 次 IPC):先空候选同步注册,让 profile 立刻可用;
       异步 hydrate 后就地回填同一对象 —— suggest.ts 每次按键都经 host.getCliProfile
       读活引用,无需额外 notify。 */
    const profile: CliProfile = {
      id: "claude",
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
      listMcpServers: listClaudeMcpServers,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listClaudeSessions,
      readSessionStatus: readClaudeSessionStatus,
      readSessionFileIdentity: readClaudeSessionIdentity,
      readSessionUserMessages: readClaudeUserMessages,
      editMarks: CLAUDE_EDIT_MARKS,
    };
    ctx.registerCliProfile(profile);
    void listClaudeSkillSuggestions().then((skills) => {
      profile.suggestions = { ...profile.suggestions, skill: skills };
    });
  },
};
