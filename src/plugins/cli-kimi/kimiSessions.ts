/**
 * kimi 磁盘会话存储扫描 —— 自 index.tsx 拆出(文件规模铁则)。
 *
 * 布局(实证自本机 kimi-code 0.40.1;0.34 旧布局仅留兜底):
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
 * - 恢复:--session <session_id>。kimi 校验 resume 时 cwd 必须等于会话创建目录
 *   (实测报 "created under a different directory"),listSessions 按 cwd 过滤 +
 *   openDiskSession 以 workspace.root 起进程,天然满足。
 * 纯函数(normalizeKimiTitle / parseKimiState / kimiStateTitle / matchKimiStatePath /
 * kimiUserMessageLine / extractKimiTitle)由 index.test.ts 从本文件直引测试。
 */

import { ipc } from "@kernel/ipc";
import {
  messageText,
  readUserMessagesFromFile,
  type UserMessageLineParser,
} from "../cli-shared/userMessages";
import type { CliDiskSession } from "@kernel/cli";

/** 标题展示最大长度(与 cli-shared/diskSessions 的通用规则一致)。 */
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
  /* state.json 读取互不依赖,并发一次发出;单文件坏/读失败 catch 成 null 跳过,
     容错语义不变;LIMIT 截断与落表保持 files 原序。 */
  const probed = await Promise.all(
    files.map(async (f) => {
      const m = matchKimiStatePath(f.path);
      if (!m) return null;
      const text = await ipc.fsReadFile(f.path).catch(() => null);
      const state = text ? parseKimiState(text) : null;
      /* 归档会话 kimi 自己的 picker 也默认隐藏;cwd 缺失(首回合未落盘)= 还归属不明 */
      if (!state || state.archived || !state.cwd || !sameDir(state.cwd, cwd)) return null;
      return { m, modifiedAt: f.modifiedAt, state };
    }),
  );
  const sessions: CliDiskSession[] = [];
  const wirePaths = new Map(wirePathById);
  for (const hit of probed) {
    if (!hit) continue;
    if (sessions.length >= KIMI_SCAN_LIMIT) break;
    wirePaths.set(hit.m.id, `${hit.m.dir}/agents/main/wire.jsonl`);
    sessions.push({
      id: hit.m.id,
      modifiedAt: hit.modifiedAt,
      /* path 约定"磁盘路径":kimi 会话是目录,CliDiskSession.path 指向目录,
         删除(fs_remove_path)按整目录删,与 CLI 自删的 rm -rf 语义一致 */
      path: hit.m.dir,
      title: kimiStateTitle(hit.state),
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
  const matched = files.flatMap((f) => {
    const m = f.path.match(
      /[\\/]([0-9a-f]{32})[\\/]([0-9a-f-]{36})[\\/]wire\.jsonl$/,
    );
    return m && m[1] === dirHash
      ? [{ id: m[2], hash: m[1], modifiedAt: f.modifiedAt, path: f.path }]
      : [];
  });
  /* wire.jsonl 读头互不依赖,并发一次发出;单文件读失败 catch 成 ""(无标题),
     容错语义不变;LIMIT 截断与落表保持 files 原序。 */
  const heads = await Promise.all(
    matched.map((entry) => ipc.fsReadHead(entry.path, 8 * 1024).catch(() => "")),
  );
  const sessions: CliDiskSession[] = [];
  const wirePaths = new Map(wirePathById);
  for (const [i, entry] of matched.entries()) {
    if (sessions.length >= KIMI_SCAN_LIMIT) break;
    wirePaths.set(entry.id, entry.path);
    const head = heads[i];
    sessions.push({
      id: entry.id,
      modifiedAt: entry.modifiedAt,
      path: `${root}/${entry.hash}/${entry.id}`,
      title: head ? extractKimiTitle(head) : undefined,
    });
  }
  wirePathById = wirePaths;
  return sessions;
}

export async function listKimiSessions(cwd: string): Promise<CliDiskSession[]> {
  const dataHome = await kimiDataHome();
  if (!dataHome) return [];
  if (dataHome.endsWith(".kimi-code")) {
    return listModernKimiSessions(`${dataHome}/sessions`, cwd);
  }
  const dirHash = await ipc.md5Hex(cwd).catch(() => null);
  if (!dirHash) return [];
  return listLegacyKimiSessions(`${dataHome}/sessions`, dirHash);
}

/** 身份自证:path = 会话目录,state.json 自带 id/cwd/createdAt(ms epoch)。 */
export async function readKimiSessionIdentity(path: string) {
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

export async function readKimiUserMessages(
  cwd: string,
  cliSessionId: string,
  full: boolean,
) {
  const path = await kimiWirePath(cwd, cliSessionId);
  if (!path) return null;
  return readUserMessagesFromFile(path, full, kimiUserMessageLine);
}
