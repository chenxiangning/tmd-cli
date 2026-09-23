import { CodexGlyph } from "../cli-shared/engineGlyphs";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  codexUserMessageLine,
  findJsonlSessionFile,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { listCodexSessions } from "./sessions";
import { HEAD_BYTES, extractMeta, readCodexSessionStatus } from "./sessionStatus";
import { pathsEqual } from "@kernel/pathUtils";
import { getPlatformKind } from "@kernel/platform";
import { readCodexSessionEdits } from "./edits";
import { fetchCodexQuota } from "./quota";
import type { CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { listCodexSuggestions } from "./scanSuggestions";
import { codexConfigEntry } from "./configGui";
import { applyCodexChannel } from "./channelApply";
import { ProviderChannelsCard } from "@plugins/cli-shared/providerChannels";
import { isJsonlSessionEmpty } from "../cli-shared/sessionEmpty";

/* macOS APFS / Windows NTFS 默认大小写不敏感,cwd 严格相等会在大小写/分隔符差异时漏配。 */
const CASE_INSENSITIVE_FS = getPlatformKind() !== "linux";

/**
 * codex 磁盘会话存储(实证自 ~/.codex/sessions/ 真实目录):
 * - 目录 = ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl
 * - 不按 cwd 分目录:首行 session_meta.payload 内含 id + cwd,据此过滤。
 * - meta 行含完整 system prompt(可达数十 KB),不做整行 JSON.parse,
 *   只从头部 4KB 正则提取 id/cwd(两字段在 payload 最前,实证 <300 字节)。
 */

/**
 * 身份自证:首行 session_meta payload 的 id/cwd/timestamp(实证 2026-09-03)。
 * payload.timestamp = 会话创建时刻(ISO),内容级绑定按它对齐 spawn 时刻。
 */
async function readCodexSessionIdentity(path: string) {
  const head = await ipc.fsReadHead(path, 8 * 1024).catch(() => null);
  if (!head) return null;
  const firstLine = head.split("\n", 1)[0];
  if (!firstLine.includes('"type":"session_meta"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("payload" in parsed)) return null;
  const payload: unknown = (parsed as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object") return null;
  const frame = payload as Record<string, unknown>;
  if (typeof frame.id !== "string" || !frame.id) return null;
  const ts = typeof frame.timestamp === "string" ? Date.parse(frame.timestamp) : NaN;
  return {
    id: frame.id,
    cwd: typeof frame.cwd === "string" && frame.cwd ? frame.cwd : undefined,
    createdAt: Number.isFinite(ts) ? ts : undefined,
  };
}

/* 磁盘会话扫描在 ./sessions(叶子模块,移动端 home 历史同源复用)。 */

/** codex rollout 文件名含会话 id;resume/fork 产生同 id 新文件,取 mtime 最新(collect 已倒序,先见即最新)。 */
async function readCodexUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const path = await findJsonlSessionFile(`${home}/.codex/sessions`, cliSessionId);
  if (!path) return null;
  /* 与 readCodexSessionStatus 同一道防线:rollout 不按 cwd 分目录,meta 校验归属防跨工作区误读 */
  const head = await ipc.fsReadHead(path, HEAD_BYTES).catch(() => "");
  const meta = head ? extractMeta(head) : null;
  if (!meta || !pathsEqual(meta.cwd, cwd, CASE_INSENSITIVE_FS)) return null;
  return readUserMessagesFromFile(path, full, codexUserMessageLine);
}

/**
 * codex / 命令候选(官方 CLI 参考;此前未声明,M4 补齐 —— proposal §初判表)。
 * action 初判:picker/状态类 bare 合法 → send;/mention 需路径参数 → insert。
 * $ 技能为原生 mentions(CLI 自发现),不在此静态声明。
 */
export const CODEX_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "model", description: "查看/切换模型(幕布内 picker)", action: "send", icon: "model" },
  { value: "status", description: "会话与配置状态", action: "send", icon: "usage" },
  { value: "diff", description: "查看改动 diff", action: "send", icon: "review" },
  { value: "init", description: "初始化 AGENTS.md", action: "send", icon: "help" },
  { value: "compact", description: "压缩会话上下文", action: "send", icon: "compact" },
  { value: "review", description: "代码评审", action: "send", icon: "review" },
  { value: "permissions", description: "查看/管理审批规则", action: "send", icon: "plan" },
  { value: "skills", description: "查看/注入技能", action: "send", icon: "skills" },
  { value: "mention", description: "引用文件(需路径参数)", icon: "resume" },
];

/**
 * MCP 配置真相 = ~/.codex/config.toml 的 [mcp_servers.<name>] 段(本机实证)。
 * 点击语义:insert "$<name>"(codex 原生 $ mention)。TOML 不引解析库:
 * 轻量按行提取段头即可,name + command 够抽屉展示。
 * 纯函数可测;解析失败由调用方兜底为空。
 */
export function extractCodexMcpServers(toml: string): CliSuggestion[] {
  const found: { name: string; command?: string }[] = [];
  let current: { name: string; command?: string } | null = null;
  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    const header = line.match(/^\[mcp_servers\.([^.\]]+)\]$/);
    if (header) {
      if (current) found.push(current);
      current = { name: header[1] };
      continue;
    }
    if (!current) continue;
    const cmd = line.match(/^command\s*=\s*"([^"]*)"/);
    if (cmd) current.command = cmd[1];
  }
  if (current) found.push(current);
  return found.map((s) => ({
    value: s.name,
    description: s.command ? `MCP · ${s.command}` : t("MCP 服务器"),
    action: "insert" as const,
    icon: "server",
    token: `$${s.name} `,
  }));
}

async function listCodexMcpServers(): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const toml = await ipc.fsReadFile(`${home}/.codex/config.toml`).catch(() => "");
  if (!toml) return null;
  return extractCodexMcpServers(toml);
}

/**
 * codex CLI 插件（CLI 能力矩阵调研结论）：
 * 三个触发符 `$` `/` `@` 全部原生支持，零翻译纯透传。
 * 会话恢复：codex resume <id>；历史列表 = 扫 codex 自己的 rollout 目录按 cwd 过滤。
 */
export const cliCodexPlugin: Plugin = {
  id: "cli-codex",
  meta: {
    name: "Codex CLI",
    abbr: "CX",
    desc: "Codex CLI 引擎:rollout 扫描、配额",
    icon: CodexGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    ctx.registerCliConfig({ ...codexConfigEntry, icon: (size) => <CodexGlyph size={size} />, providerPanel: () => <ProviderChannelsCard engineId="codex" applyChannel={applyCodexChannel} /> });
    ctx.registerCliProfile({
      id: "codex",
      fetchQuota: fetchCodexQuota,
      docsUrl: "https://github.com/openai/codex",
      npmPackage: "@openai/codex",
      name: "codex",
      renderIcon: (size) => <CodexGlyph size={size} />,
      command: "codex",
      args: [],
      triggers: [
        { char: "$", kind: "skill" },
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
      ],
      suggestions: {
        command: CODEX_COMMAND_SUGGESTIONS,
        skill: [],
      },
      /* bracketedPaste:实测(PTY 探针)裸「文本+CR」单 chunk 在 codex 启动/恢复窗
         与斜杠弹层活跃态会被编辑器吞掉回车,BP 标记后 /model 稳定执行。
         codex 非 pi-tui 系,但 crossterm 同样启用 BP 模式(见 kernel/cliProfile.ts)。 */
      bracketedPaste: true,
      /* 技能真相:扫 .agents/skills + ~/.codex/skills(含 .system)+ 插件缓存;
         ~/.codex/prompts 已废弃不扫,命令走静态表 */
      listSuggestions: listCodexSuggestions,
      listMcpServers: () => listCodexMcpServers(),
      resumeArgs: (sessionId) => ["resume", sessionId],
      listSessions: listCodexSessions,
      /* 会话卫生判空:path 即 rollout jsonl,共享标记子串判定(sessionEmpty.ts) */
      isDiskSessionEmpty: (session) => isJsonlSessionEmpty(session.path),
      readSessionStatus: readCodexSessionStatus,
      readSessionFileIdentity: readCodexSessionIdentity,
      readSessionUserMessages: readCodexUserMessages,
      readSessionEdits: readCodexSessionEdits,
    });
  },
};
