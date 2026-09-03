import { ipc } from "@kernel/ipc";
import {
  grokUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import {
  readGrokDefaultStatus,
} from "./configStatus";
import { readGrokSessionEdits } from "./edits";
import { registerGrokQuotaProvider } from "./quota";
import type {
  CliDiskSession,
  CliProfile,
  CliSessionStatus,
  CliSuggestion,
} from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * grok / 命令候选(官方 README 斜杠命令表;action 初判见
 * openspec/changes/composer-command-drawer,/model /load 等 picker 类已拍板 send)。
 */
export const GROK_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "model", description: "查看/切换模型(幕布内 picker)", action: "send", icon: "model" },
  { value: "new", description: "新建会话(清空上下文)", action: "send", icon: "compact" },
  { value: "load", description: "恢复历史会话(幕布内 picker)", action: "send", icon: "resume" },
  { value: "compact", description: "压缩会话上下文", action: "send", icon: "compact" },
  { value: "skills", description: "查看/注入技能", action: "send", icon: "skills" },
  { value: "plugins", description: "管理插件", action: "send", icon: "plugins" },
];

/**
 * grok 品牌 glyph:xAI 官方斜杠标志(vendored 自 grok-build-vscode media/grok.svg,
 * 与 omp/claude glyph 同源策略;viewBox 0 0 24 24 官方一致)。
 * 官方为单色 mark → currentColor 随主题(codex 同法),evenodd 官方一致。
 */
const GROK_ICON_PATH =
  "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" as const;

function GrokGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path d={GROK_ICON_PATH} fillRule="evenodd" />
    </svg>
  );
}

/**
 * grok 磁盘会话存储(实证自 ~/.grok/sessions/ 真实目录,grok 1.0.4):
 * - 目录 = ~/.grok/sessions/<encodeURIComponent(cwd)>/<session-uuid>/
 *   会话是目录而非单文件;目录名即 sessionId(encodeURIComponent:/→%2F、
 *   中文→%E5%86%85…,实证 /Users/x/code/内容分析 → %2FUsers%2Fx%2Fcode%2F%E5%86%85…分析)。
 *   已知边界:Windows cwd 反斜杠路径的编码形态未实证(本机仅 macOS),扫不到 = 空列表降级。
 * - 会话目录内 summary.json 是元数据真相:generated_title/session_summary(标题)、
 *   current_model_id(模型)、updated_at/last_active_at(时间)。
 * - 对话记录 = chat_history.jsonl;真实用户输入包裹 <user_query> 标签。
 */
export function grokSessionsDirName(cwd: string): string {
  return encodeURIComponent(cwd);
}

async function grokSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/.grok/sessions/${grokSessionsDirName(cwd)}`;
}

/** summary.json 的解析结果(纯数据,可测)。 */
export interface GrokSummary {
  title?: string;
  model?: string;
  /** updated_at(优先)或 last_active_at 的 ms epoch;解析失败 = undefined。 */
  updatedAt?: number;
}

/** 外部 JSON 逐层收窄取 string;缺失/异型/空串返回 undefined。 */
function summaryString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * summary.json 文本 → 会话元数据(纯函数,可测)。
 * 实证字段:info.{id,cwd}、generated_title ≈ session_summary、
 * current_model_id、updated_at/last_active_at(ISO 8601)。
 */
export function parseGrokSummary(raw: string): GrokSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title =
    summaryString(parsed, "generated_title") ?? summaryString(parsed, "session_summary");
  const model = summaryString(parsed, "current_model_id");
  const iso =
    summaryString(parsed, "updated_at") ?? summaryString(parsed, "last_active_at");
  const ms = iso ? Date.parse(iso) : NaN;
  return {
    title,
    model,
    updatedAt: Number.isFinite(ms) ? ms : undefined,
  };
}

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 身份自证:path = 会话目录,summary.json 的 info.{id,cwd} + created_at
 * (会话创建时刻,ISO 8601;内容级绑定按它对齐 spawn 时刻)。
 */
async function readGrokSessionIdentity(path: string) {
  const raw = await ipc.fsReadFile(`${path}/summary.json`).catch(() => null);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const info: unknown = (parsed as Record<string, unknown>).info;
  if (!info || typeof info !== "object") return null;
  const id = summaryString(info, "id");
  if (!id) return null;
  const iso = summaryString(parsed, "created_at");
  const ms = iso ? Date.parse(iso) : NaN;
  return {
    id,
    cwd: summaryString(info, "cwd"),
    createdAt: Number.isFinite(ms) ? ms : undefined,
  };
}

async function listGrokSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return [];
  const entries = await ipc.fsListDir(dir).catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const entry of entries) {
    // 会话目录 = UUID 命名;summary.json.lock 等杂项天然被正则排除。
    if (!entry.isDir || !SESSION_ID_RE.test(entry.name)) continue;
    const raw = await ipc
      .fsReadFile(`${dir}/${entry.name}/summary.json`)
      .catch(() => null);
    const summary = raw ? parseGrokSummary(raw) : null;
    sessions.push({
      id: entry.name,
      title: summary?.title,
      modifiedAt: summary?.updatedAt ?? 0,
      path: `${dir}/${entry.name}`,
    });
  }
  return sessions;
}

async function readGrokSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return null;
  const raw = await ipc
    .fsReadFile(`${dir}/${cliSessionId}/summary.json`)
    .catch(() => null);
  const model = raw ? parseGrokSummary(raw)?.model : undefined;
  // grok 推理强度不落盘到 summary(会话内 /model 或 --reasoning-effort 私有态),不提供 thinkingLevel。
  return model ? { model } : null;
}

/** grok 文件路径由会话目录布局直接可得,免扫目录。 */
async function readGrokUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return null;
  return readUserMessagesFromFile(
    `${dir}/${cliSessionId}/chat_history.jsonl`,
    full,
    grokUserMessageLine,
  );
}

/**
 * $ 触发符候选 = 用户真实安装的 skills(实证 ~/.grok/skills/<name>/SKILL.md,
 * 目录名即 skill 名;另有 ./.grok/skills 项目级与 ~/.claude/skills 复用,activate
 * 时无 cwd,只扫 home 级)。同 claude:扫真实磁盘,不猜名字;失败 = 空候选。
 */
async function listGrokSkillSuggestions(): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const entries = await ipc.fsListDir(`${home}/.grok/skills`).catch(() => []);
  return entries.filter((e) => e.isDir).map((e) => ({ value: e.name }));
}

/**
 * grok CLI 插件(xAI Grok Build,CLI 能力矩阵 + 本机 1.0.4 实证):
 * - `/` 命令、`@` 文件引用:官方文档明载,纯透传。
 * - `$` skill:grok 原生 skill 注入入口是 /skills <name>(README 斜杠命令表),
 *   发送时翻译(同 omp 的 $→/skill: 方案)。
 * - 会话恢复:grok --resume <uuid>;历史列表 = 扫 grok 自己的 sessions 目录。
 */
export const cliGrokPlugin: Plugin = {
  id: "cli-grok",
  meta: {
    name: "Grok",
    abbr: "GK",
    desc: "Grok Build 引擎:会话扫描、配额、状态",
    icon: GrokGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    // 注册 grok quota provider(config.toml 凭据 → 供应商 HTTP 面)。
    registerGrokQuotaProvider();
    /* 激活不等待 skills 扫盘(2 次 IPC):先空候选同步注册,让 profile 立刻可用;
       异步 hydrate 后就地回填同一对象(与 cli-claude 同法)。 */
    const profile: CliProfile = {
      id: "grok",
      name: "grok",
      renderIcon: (size: number) => <GrokGlyph size={size} />,
      command: "grok",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token: string) => `/skills ${token.replace(/^\$/, "")}`,
        },
      ],
      suggestions: {
        command: GROK_COMMAND_SUGGESTIONS,
        skill: [],
      },
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listGrokSessions,
      readSessionStatus: readGrokSessionStatus,
      readSessionFileIdentity: readGrokSessionIdentity,
      readSessionUserMessages: readGrokUserMessages,
      readSessionEdits: readGrokSessionEdits,
      readDefaultStatus: readGrokDefaultStatus,
    };
    ctx.registerCliProfile(profile);
    void listGrokSkillSuggestions().then((skills) => {
      profile.suggestions = { ...profile.suggestions, skill: skills };
    });
  },
};
