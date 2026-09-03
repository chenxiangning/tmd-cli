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
 * kimi 磁盘会话存储(实证自本机 kimi-code 0.40.1;0.34 旧布局仅留兜底):
 * - 0.40 起数据 home 从 ~/.kimi 迁到 ~/.kimi-code(实证 ~/.kimi/.migrated-to-kimi-code
 *   标记,旧会话已全部搬运转格式)。老 home 仅在 .kimi-code 不存在(未装新版)时兜底。
 * - 新布局:~/.kimi-code/sessions/<wd桶>/<session_id>/ 目录:
 *   - state.json 自描述元数据 —— cwd(旧键名 workDir)、title、lastPrompt、archived。
 *     桶名 wd_<slug>_<sha256(cwd)前12位> 会被 registry 覆盖(实证 wd_workspace_*),
 *     不可反推 cwd → 按 state.json 里的 cwd 过滤,与 kimi 自身 reindex 恢复
 *     workDir 同路。
 *   - agents/main/wire.jsonl 追加事件流,protocol 1.4 行型:
 *     {"type":"turn.prompt","agentId":"main","input":[…],"origin":{"kind":"user"},
 *      "promptId":"msg_…","time":<ms epoch>}
 *     迁移过的老会话也统一转成 1.4;1.1 时代的 TurnBegin 行型只存在于老 home。
 * - 模型真相在 ~/.kimi-code/config.toml(default_model);/model 切换即写全局
 *   配置并热重载,会话层无独立模型事件 → 两类读取同源。
 * - 恢复:--session <session_id>。kimi 校验 resume 时 cwd 必须等于会话创建目录
 *   (实测报 "created under a different directory"),listSessions 按 cwd 过滤 +
 *   openDiskSession 以 workspace.root 起进程,天然满足。
 */

/** 标题展示最大长度(与 kernel/diskSessions 的通用规则一致)。 */
const TITLE_MAX_CHARS = 60;
/** 扫描上限:fsCollectFiles 按 mtime 倒序,只解析最近 N 个会话的状态。 */
const KIMI_SCAN_LIMIT = 200;
/** kimi 原生占位标题:首回合未完成时写入,展示上降级到 lastPrompt。 */
const KIMI_PLACEHOLDER_TITLE = "New Session";

/** kimi 数据 home:~/.kimi-code(0.40+);不存在(老版机器)= ~/.kimi;home 取不到 = null。 */
async function kimiDataHome(): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const modern = `${home}/.kimi-code`;
  /* fsListDir 对不存在目录 reject → 存在性探测选 home;空目录返回 [] 视为存在 */
  const exists = await ipc.fsListDir(modern).then(
    () => true,
    () => false,
  );
  return exists ? modern : `${home}/.kimi`;
}

/** 标题归一:折叠空白 + 截断补省略号(纯函数,可测)。 */
export function normalizeKimiTitle(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > TITLE_MAX_CHARS
    ? text.slice(0, TITLE_MAX_CHARS - 1) + "…"
    : text;
}

/**
 * state.json 文本 → 归一结构(纯函数,可测);坏 JSON/异型 = null。
 * cwd 键名 v2 为 cwd、v1 为 workDir,读取时双键兼容。
 * id/createdAt 供内容级身份绑定(readSessionFileIdentity)消费。
 */
export function parseKimiState(text: string): {
  id?: string;
  cwd?: string;
  createdAt?: number;
  title?: string;
  lastPrompt?: string;
  archived: boolean;
} | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const state = raw as Record<string, unknown>;
  const str = (value: unknown) =>
    typeof value === "string" && value ? value : undefined;
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return {
    id: str(state.id),
    cwd: str(state.cwd) ?? str(state.workDir),
    createdAt: num(state.createdAt),
    title: str(state.title),
    lastPrompt: str(state.lastPrompt),
    archived: state.archived === true,
  };
}

/** state → 展示标题(纯函数,可测):title(占位除外)> lastPrompt > undefined(UI 回退短码)。 */
export function kimiStateTitle(state: {
  title?: string;
  lastPrompt?: string;
}): string | undefined {
  if (state.title && state.title !== KIMI_PLACEHOLDER_TITLE) {
    return normalizeKimiTitle(state.title);
  }
  if (state.lastPrompt) return normalizeKimiTitle(state.lastPrompt);
  return undefined;
}

/** state.json 绝对路径 → { id, 会话目录 };非 <桶>/<session_id>/state.json 布局 = null。 */
export function matchKimiStatePath(
  path: string,
): { id: string; dir: string } | null {
  const m = path.match(/[\\/]([^\\/]+)[\\/](session_[^\\/]+)[\\/]state\.json$/);
  if (!m) return null;
  return { id: m[2], dir: path.slice(0, path.length - "/state.json".length) };
}

/** cwd 等值比较:去尾分隔符(防御路径手滑,不做 realpath —— kimi 自己也不做)。 */
function sameDir(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
}

/**
 * wire 行解析器:用户消息(纯函数,可测)。双协议并存:
 * - 1.4(kimi-code 0.40+):turn.prompt 行,origin.kind === "user" 判别人工输入;
 *   id 取 promptId(原生稳定键),缺失用 time(ms epoch) 兜底。
 * - 1.1(老 home):TurnBegin 事件 payload.user_input;无原生消息 id,
 *   用事件时间戳充当 —— wire.jsonl 追加写,时间戳单调稳定,跨增量窗口去重语义成立。
 * user_input 非文本段(图片等)由 messageText 跳过。
 */
export const kimiUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type === "turn.prompt") {
    const origin = event.origin;
    if (
      origin &&
      typeof origin === "object" &&
      (origin as Record<string, unknown>).kind !== "user"
    ) {
      return null;
    }
    const text = messageText(event.input);
    if (!text) return null;
    if (typeof event.promptId === "string" && event.promptId) {
      return { id: event.promptId, text };
    }
    return typeof event.time === "number" ? { id: `t${event.time}`, text } : null;
  }
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

/** 会话 wire 头部 → 展示标题:第一条 TurnBegin 用户输入(纯函数,可测;仅老 home 布局使用)。 */
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

/** id → wire.jsonl 绝对路径缓存:每次列表扫描增量合并(多工作区扫描交错不互踢),
    锚点栏 2s 轮询零扫描直取。失效残留(会话被删)读文件失败返回 null,无副作用。 */
let wirePathById = new Map<string, string>();

/** 新 home 扫描:<桶>/<session_id>/state.json,按 state.cwd 过滤出本工作区会话。 */
async function listModernKimiSessions(
  root: string,
  cwd: string,
): Promise<CliDiskSession[]> {
  const files = await ipc.fsCollectFiles(root, ".json").catch(() => []);
  const sessions: CliDiskSession[] = [];
  const wirePaths = new Map(wirePathById);
  for (const f of files) {
    if (sessions.length >= KIMI_SCAN_LIMIT) break;
    const m = matchKimiStatePath(f.path);
    if (!m) continue;
    const text = await ipc.fsReadFile(f.path).catch(() => null);
    const state = text ? parseKimiState(text) : null;
    /* 归档会话 kimi 自己的 picker 也默认隐藏;cwd 缺失(首回合未落盘)= 还归属不明 */
    if (!state || state.archived || !state.cwd || !sameDir(state.cwd, cwd)) {
      continue;
    }
    wirePaths.set(m.id, `${m.dir}/agents/main/wire.jsonl`);
    sessions.push({
      id: m.id,
      modifiedAt: f.modifiedAt,
      /* path 约定"磁盘路径":kimi 会话是目录,CliDiskSession.path 指向目录,
         删除(fs_remove_path)按整目录删,与 CLI 自删的 rm -rf 语义一致 */
      path: m.dir,
      title: kimiStateTitle(state),
    });
  }
  wirePathById = wirePaths;
  return sessions;
}

/** 老 home(~/.kimi,≤0.34)扫描:<md5(cwd)>/<uuid>/wire.jsonl;分隔符双向兼容 Windows。 */
async function listLegacyKimiSessions(
  root: string,
  dirHash: string,
): Promise<CliDiskSession[]> {
  const files = await ipc.fsCollectFiles(root, ".jsonl").catch(() => []);
  const sessions: CliDiskSession[] = [];
  const wirePaths = new Map(wirePathById);
  for (const f of files) {
    const m = f.path.match(
      /[\\/]([0-9a-f]{32})[\\/]([0-9a-f-]{36})[\\/]wire\.jsonl$/,
    );
    if (!m || m[1] !== dirHash) continue;
    if (sessions.length >= KIMI_SCAN_LIMIT) break;
    wirePaths.set(m[2], f.path);
    const head = await ipc.fsReadHead(f.path, 8 * 1024).catch(() => "");
    sessions.push({
      id: m[2],
      modifiedAt: f.modifiedAt,
      path: `${root}/${m[1]}/${m[2]}`,
      title: head ? extractKimiTitle(head) : undefined,
    });
  }
  wirePathById = wirePaths;
  return sessions;
}

async function listKimiSessions(cwd: string): Promise<CliDiskSession[]> {
  const dataHome = await kimiDataHome();
  if (!dataHome) return [];
  if (dataHome.endsWith(".kimi-code")) {
    return listModernKimiSessions(`${dataHome}/sessions`, cwd);
  }
  const dirHash = await ipc.md5Hex(cwd).catch(() => null);
  if (!dirHash) return [];
  return listLegacyKimiSessions(`${dataHome}/sessions`, dirHash);
}

/**
 * config.toml → 默认模型/思考强度(纯函数,可测)。
 * 行级最小解析(不引入 toml 依赖):配置面只消费这几个键,契约由单测守护。
 * 思考键双代并存:0.40 后期起为 [thinking] 段(enabled 布尔 + effort 档位,
 * 实证本机 config.toml),更早为 default_thinking 布尔 → 映射 "on"/"off"。
 * [thinking] 段优先于旧键;全缺 → thinkingLevel undefined,工具栏显示 "—"。
 */
export function parseKimiConfigStatus(configToml: string): CliSessionStatus | null {
  const model = configToml.match(/^default_model\s*=\s*"([^"]+)"/m)?.[1];
  const legacy = configToml.match(/^default_thinking\s*=\s*(true|false)/m)?.[1];
  const section = configToml.match(/^\[thinking\]\s*\n((?:[^\[].*\n?|\n.*)*?)(?=^\[|\s*$)/m)?.[1];
  const enabled = section?.match(/^enabled\s*=\s*(true|false)\s*$/m)?.[1];
  const effort = section?.match(/^effort\s*=\s*"([^"]+)"/m)?.[1];
  let thinkingLevel: string | undefined;
  if (enabled === "false") {
    thinkingLevel = "off";
  } else if (effort) {
    thinkingLevel = effort;
  } else if (legacy !== undefined) {
    thinkingLevel = legacy === "true" ? "on" : "off";
  }
  if (!model && thinkingLevel === undefined) return null;
  return { model, thinkingLevel };
}

/**
 * 读取模型/思考强度。kimi 的模型真相只在全局 config.toml(实证 0.40:
 * /model 写配置并热重载,wire.jsonl 无模型事件)→ 会话态与默认态同源。
 * home 迁移双路径:~/.kimi-code 优先,老 ~/.kimi 兜底(键型一致)。
 */
async function readKimiConfigStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  for (const path of [
    `${home}/.kimi-code/config.toml`,
    `${home}/.kimi/config.toml`,
  ]) {
    const text = await ipc.fsReadFile(path).catch(() => null);
    const status = text ? parseKimiConfigStatus(text) : null;
    if (status) return status;
  }
  return null;
}

/** 身份自证:path = 会话目录,state.json 自带 id/cwd/createdAt(ms epoch)。 */
async function readKimiSessionIdentity(path: string) {
  const text = await ipc.fsReadFile(`${path}/state.json`).catch(() => null);
  const state = text ? parseKimiState(text) : null;
  if (!state?.id) return null;
  return { id: state.id, cwd: state.cwd, createdAt: state.createdAt };
}

async function kimiWirePath(
  cwd: string,
  cliSessionId: string,
): Promise<string | null> {
  const cached = wirePathById.get(cliSessionId);
  if (cached) return cached;
  /* 冷启动(openDiskSession 先于任何列表刷新):重建一次扫描再取 */
  await listKimiSessions(cwd).catch(() => undefined);
  return wirePathById.get(cliSessionId) ?? null;
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
 * kimi CLI 插件(CLI 能力矩阵调研结论 + 本机 0.40.1 实证):
 * - `/` = 内置命令、`@` = 文件路径补全:原生支持,纯透传
 * - `$` = skill:kimi 原生语法 /skill:<name>,发送时翻译(与 omp 同方案)
 * - bracketedPaste:pi-tui 系编辑器整串写入会被粘贴爆发启发式吞掉回车
 *   (composer 发送不执行的问题1根因),标记注入让 CLI 走 handlePaste 通路
 * - 会话恢复:--session <session_id>(0.40 id 自带 session_ 前缀);历史列表 =
 *   扫 ~/.kimi-code/sessions 桶下 state.json(按 cwd 过滤)
 */
export const cliKimiPlugin: Plugin = {
  id: "cli-kimi",
  meta: {
    name: "Kimi",
    abbr: "KI",
    desc: "Kimi Code CLI 引擎:kimi-code 会话桶、config 状态",
    icon: KimiGlyph,
    iconColor: "#1783FF",
    category: "engine",
  },
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
      bracketedPaste: true,
      listSessions: listKimiSessions,
      readSessionStatus: () => readKimiConfigStatus(),
      readSessionFileIdentity: readKimiSessionIdentity,
      readDefaultStatus: readKimiConfigStatus,
      readSessionUserMessages: readKimiUserMessages,
    };
    ctx.registerCliProfile(profile);
  },
};
