import { ipc } from "@kernel/ipc";
import {
  codexUserMessageLine,
  findJsonlSessionFile,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { extractJsonlTitle } from "@kernel/diskSessions";
import { pathsEqual } from "@kernel/pathUtils";
import { getPlatformKind } from "@kernel/platform";
import { registerCodexQuotaProvider } from "./quota";
import type { CliDiskSession, CliSessionStatus, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/* macOS APFS / Windows NTFS 默认大小写不敏感,cwd 严格相等会在大小写/分隔符差异时漏配。 */
const CASE_INSENSITIVE_FS = getPlatformKind() !== "linux";

/** codex 用 OpenAI 六边形 glyph(codemoss EngineIcon 同源),currentColor 随主题。 */
function CodexGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path
        d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

/**
 * codex 磁盘会话存储(实证自 ~/.codex/sessions/ 真实目录):
 * - 目录 = ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl
 * - 不按 cwd 分目录:首行 session_meta.payload 内含 id + cwd,据此过滤。
 * - meta 行含完整 system prompt(可达数十 KB),不做整行 JSON.parse,
 *   只从头部 4KB 正则提取 id/cwd(两字段在 payload 最前,实证 <300 字节)。
 */

/** 扫描上限:rollout 已按 mtime 倒序,只解析最近 N 个文件的头部。 */
const SCAN_LIMIT = 200;
/** 每个工作区展示上限。 */
const RESULT_LIMIT = 200; // 与 SCAN_LIMIT 对齐:展示层分页(10/20/40/80),扫描不必再卡小上限
/** meta 头部读取字节数。 */
const HEAD_BYTES = 4096;

function extractMeta(head: string): { id: string; cwd: string } | null {
  // 只认首行 session_meta,防止误匹配对话内容里的同名字段
  const firstLine = head.split("\n", 1)[0];
  if (!firstLine.includes('"type":"session_meta"')) return null;
  const id = firstLine.match(/"id":"([0-9a-f-]{36})"/)?.[1];
  const rawCwd = firstLine.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!id || !rawCwd) return null;
  try {
    return { id, cwd: JSON.parse(`"${rawCwd}"`) as string };
  } catch {
    return null;
  }
}

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

async function listCodexSessions(cwd: string): Promise<CliDiskSession[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of rollouts.slice(0, SCAN_LIMIT)) {
    if (sessions.length >= RESULT_LIMIT) break;
    const head = await ipc.fsReadHead(f.path, HEAD_BYTES).catch(() => "");
    const meta = head ? extractMeta(head) : null;
    if (!meta || !pathsEqual(meta.cwd, cwd, CASE_INSENSITIVE_FS)) continue;
    // codex resume/fork 会在新日期目录写同 id 的新 rollout 文件:
    // 按 id 去重,保留最新 mtime(rollouts 已按 mtime 倒序,先见即最新)
    if (sessions.some((s) => s.id === meta.id)) continue;
    // codex 无 title 概念:标题 = 首条 role:user 的 response_item 文本。
    // meta 行带完整 system prompt(可达数十 KB),首条用户消息位置深,
    // 只对通过 cwd 过滤的本工作区会话读大窗口(4KB meta 窗照旧先筛,成本可控)。
    const titleHead = await ipc
      .fsReadHead(f.path, CODEX_TITLE_HEAD_BYTES)
      .catch(() => "");
    const title = titleHead ? extractJsonlTitle(titleHead) : undefined;
    sessions.push({ id: meta.id, modifiedAt: f.modifiedAt, path: f.path, title });
  }
  return sessions;
}
/** 标题提取的头部窗口:system prompt/skills 指令膨胀后首条用户消息可能在数十 KB 处。 */
const CODEX_TITLE_HEAD_BYTES = 128 * 1024;
 
async function readCodexSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  const file = rollouts.find((entry) => entry.name.includes(cliSessionId));
  if (!file) return null;

  const head = await ipc.fsReadHead(file.path, HEAD_BYTES).catch(() => "");
  const meta = head ? extractMeta(head) : null;
  if (meta && !pathsEqual(meta.cwd, cwd, CASE_INSENSITIVE_FS)) return null;
  const tail = await ipc.fsReadTail(file.path, 256 * 1024).catch(() => "");
  const model =
    extractLastJsonString(`${head}\n${tail}`, ["model"]) ??
    extractLastJsonString(head, ["modelId"]);
  const thinkingLevel = extractLastJsonString(tail, [
    "reasoning_effort",
    "reasoningEffort",
    "effort",
  ]);
  return model || thinkingLevel ? { model, thinkingLevel } : null;
}

function extractLastJsonString(text: string, keys: readonly string[]) {
  /* 键别名按优先级:第一个有匹配的键获胜,键内取文件位置最后一次。
     此前 result 跨键连续覆盖,最末别名(effort)会压掉更权威的
     reasoning_effort —— 与 model 路径的 `?? 优先级` 语义自相矛盾。 */
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    let found: string | undefined;
    for (const match of text.matchAll(pattern)) {
      found = match[1];
    }
    if (found !== undefined) return found;
  }
  return undefined;
}
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
    description: s.command ? `MCP · ${s.command}` : "MCP 服务器",
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
    // 注册 codex quota provider(本地 rollout 快照,零 HTTP)。
    registerCodexQuotaProvider();
    ctx.registerCliProfile({
      id: "codex",
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
      listMcpServers: () => listCodexMcpServers(),
      resumeArgs: (sessionId) => ["resume", sessionId],
      listSessions: listCodexSessions,
      readSessionStatus: readCodexSessionStatus,
      readSessionFileIdentity: readCodexSessionIdentity,
      readSessionUserMessages: readCodexUserMessages,
    });
  },
};
