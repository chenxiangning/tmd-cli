import { ipc } from "@kernel/ipc";
import {
  messageText,
  readUserMessagesFromFile,
  type UserMessageLineParser,
} from "../cli-shared/userMessages";
import type {
  CliDiskSession,
  CliProfile,
  CliSessionStatus,
  CliSuggestion,
} from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * Kimi 品牌 glyph:几何 K 字monogram(codemoss EngineIcon 同源策略),
 * currentColor 随主题 —— 与 codex 同款的品牌中性处理,不硬编码官方色值。
 */
const KIMI_ICON_PATH =
  "M5 3h4v6.6L14.6 3H20l-6.9 8.3L20 21h-5.5L9 12.9V21H5z" as const;

function KimiGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d={KIMI_ICON_PATH} />
    </svg>
  );
}

/**
 * kimi 磁盘会话存储(实证自本机 kimi 0.34.0 ~/.kimi/sessions/ 真实目录):
 * - 目录 = ~/.kimi/sessions/<MD5(cwd)>/<uuid>/{wire.jsonl, context.jsonl}
 * - MD5(cwd) 是 cwd → 会话目录的唯一映射:会话文件内不记录 cwd,
 *   `printf '<path>' | md5` 与真实目录名一致(Rust md5_hex 原语提供)。
 * - wire.jsonl 是追加事件流,行型:
 *   {"type":"metadata","protocol_version":"1.1"}
 *   {"timestamp":<float秒>,"message":{"type":"TurnBegin","payload":{"user_input":[{"type":"text","text":…}]}}}
 *   其余 StatusUpdate / ContentPart / StepBegin 等载荷不含 model 字段。
 * - 模型真相在 ~/.kimi/config.toml(default_model / default_thinking):
 *   /model 切换即写全局配置并热重载,会话层无独立模型事件 → 两类读取同源。
 */

/** 标题提取的头部窗口:首条 TurnBegin 恒在 metadata 行之后,8KB 足够。 */
const KIMI_TITLE_HEAD_BYTES = 8 * 1024;
/** 扫描上限:fsCollectFiles 按 mtime 倒序,只解析最近 N 个会话的头部。 */
const KIMI_SCAN_LIMIT = 200;
/** 标题展示最大长度(与 kernel/diskSessions 的通用规则一致)。 */
const TITLE_MAX_CHARS = 60;

/** kimi 会话根目录;home 取不到 = null(不猜)。 */
async function kimiSessionsRoot(): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  return home ? `${home}/.kimi/sessions` : null;
}

/** cwd + 会话 id → wire.jsonl 绝对路径;home/md5 任一不可得 = null。 */
async function kimiWirePath(
  cwd: string,
  cliSessionId: string,
): Promise<string | null> {
  const root = await kimiSessionsRoot();
  if (!root) return null;
  const dirHash = await ipc.md5Hex(cwd).catch(() => null);
  if (!dirHash) return null;
  return `${root}/${dirHash}/${cliSessionId}/wire.jsonl`;
}

/** 标题归一:折叠空白 + 截断补省略号(纯函数,可测)。 */
export function normalizeKimiTitle(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > TITLE_MAX_CHARS
    ? text.slice(0, TITLE_MAX_CHARS - 1) + "…"
    : text;
}

/**
 * wire 行解析器:TurnBegin 事件 → 用户消息(纯函数,可测)。
 * id 无原生消息 id,用事件时间戳充当 —— wire.jsonl 追加写,时间戳单调稳定,
 * 跨增量窗口去重语义成立。user_input 非文本段(图片等)由 messageText 跳过。
 */
export const kimiUserMessageLine: UserMessageLineParser = (event) => {
  const message = event.message;
  if (!message || typeof message !== "object") return null;
  if ((message as Record<string, unknown>).type !== "TurnBegin") return null;
  const payload = (message as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object") return null;
  const text = messageText((payload as Record<string, unknown>).user_input);
  const timestamp = event.timestamp;
  if (!text || typeof timestamp !== "number") return null;
  return { id: `t${timestamp}`, text };
};

/** 会话头部 → 展示标题:第一条 TurnBegin 用户输入(纯函数,可测)。 */
export function extractKimiTitle(head: string): string | undefined {
  for (const line of head.split("\n")) {
    if (!line.includes('"TurnBegin"')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const message = kimiUserMessageLine(event as Record<string, unknown>);
    if (message) return normalizeKimiTitle(message.text);
  }
  return undefined;
}

async function listKimiSessions(cwd: string): Promise<CliDiskSession[]> {
  const root = await kimiSessionsRoot();
  if (!root) return [];
  const dirHash = await ipc.md5Hex(cwd).catch(() => null);
  if (!dirHash) return [];
  const files = await ipc.fsCollectFiles(root, ".jsonl").catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of files) {
    /* 只认 <md5(cwd)>/<uuid>/wire.jsonl;context.jsonl 与别的工作区哈希目录跳过。
       分隔符双向兼容:Rust collect_files 在 Windows 返回反斜杠路径。 */
    const m = f.path.match(/[\\/]([0-9a-f]{32})[\\/]([0-9a-f-]{36})[\\/]wire\.jsonl$/);
    if (!m || m[1] !== dirHash) continue;
    if (sessions.length >= KIMI_SCAN_LIMIT) break;
    const head = await ipc.fsReadHead(f.path, KIMI_TITLE_HEAD_BYTES).catch(
      () => "",
    );
    sessions.push({
      id: m[2],
      modifiedAt: f.modifiedAt,
      /* path 约定"磁盘路径":kimi 会话是目录,CliDiskSession.path 指向目录,
         删除(fs_remove_path)按整目录删,避免 CLI /sessions 留幽灵会话。 */
      path: `${root}/${m[1]}/${m[2]}`,
      title: head ? extractKimiTitle(head) : undefined,
    });
  }
  return sessions;
}

/**
 * config.toml → 默认模型/思考强度(纯函数,可测)。
 * 行级最小解析(不引入 toml 依赖):配置面只消费这两个键,契约由单测守护。
 * default_thinking 是布尔,映射为工具栏可读的 "on"/"off"。
 */
export function parseKimiConfigStatus(configToml: string): CliSessionStatus | null {
  const model = configToml.match(/^default_model\s*=\s*"([^"]+)"/m)?.[1];
  const thinking = configToml.match(/^default_thinking\s*=\s*(true|false)/m)?.[1];
  if (!model && thinking === undefined) return null;
  return {
    model,
    thinkingLevel:
      thinking === undefined ? undefined : thinking === "true" ? "on" : "off",
  };
}

/**
 * 读取模型/思考强度。kimi 的模型真相只在全局 config.toml(实证 0.34:
 * /model 写配置并热重载,wire.jsonl 无模型事件)→ 会话态与默认态同源。
 */
async function readKimiConfigStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const text = await ipc.fsReadFile(`${home}/.kimi/config.toml`).catch(() => null);
  return text ? parseKimiConfigStatus(text) : null;
}

async function readKimiUserMessages(
  cwd: string,
  cliSessionId: string,
  full: boolean,
) {
  const path = await kimiWirePath(cwd, cliSessionId);
  if (!path) return null;
  return readUserMessagesFromFile(path, full, kimiUserMessageLine);
}

/**
 * `/` 内置命令候选(官方 slash-commands 参考摘选高频项;action 初判见
 * openspec/changes/composer-command-drawer,/sessions /model 等 picker 类已拍板 send)。
 */
export const KIMI_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "帮助与快捷键", action: "send", icon: "help" },
  { value: "model", description: "切换模型/思考模式(幕布内 picker)", action: "send", icon: "model" },
  { value: "sessions", description: "会话列表与切换(幕布内 picker)", action: "send", icon: "resume" },
  { value: "new", description: "新建会话", action: "send", icon: "compact" },
  { value: "title", description: "重命名当前会话(需会话名)", icon: "plan" },
  { value: "plan", description: "只读规划模式", action: "send", icon: "plan" },
  { value: "compact", description: "压缩上下文", action: "send", icon: "compact" },
  { value: "usage", description: "用量与配额", action: "send", icon: "usage" },
];

/**
 * kimi CLI 插件(CLI 能力矩阵调研结论 + 本机 0.34.0 实证):
 * - `/` = 内置命令、`@` = 文件路径补全:原生支持,纯透传
 * - `$` = skill:kimi 原生语法 /skill:<name>,发送时翻译(与 omp 同方案)
 * - 会话恢复:--session <uuid>;历史列表 = 扫 MD5(cwd) 目录下的 wire.jsonl
 */
export const cliKimiPlugin: Plugin = {
  id: "cli-kimi",
  meta: { name: "Kimi", abbr: "KI", desc: "Kimi Code CLI 引擎:MD5 目录会话、config 状态", category: "engine" },
  activate(ctx) {
    const profile: CliProfile = {
      id: "kimi",
      name: "kimi",
      renderIcon: (size) => <KimiGlyph size={size} />,
      command: "kimi",
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
      suggestions: { command: KIMI_COMMAND_SUGGESTIONS },
      resumeArgs: (sessionId) => ["--session", sessionId],
      listSessions: listKimiSessions,
      readSessionStatus: () => readKimiConfigStatus(),
      readDefaultStatus: readKimiConfigStatus,
      readSessionUserMessages: readKimiUserMessages,
    };
    ctx.registerCliProfile(profile);
  },
};
