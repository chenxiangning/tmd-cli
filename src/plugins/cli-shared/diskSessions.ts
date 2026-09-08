/**
 * jsonl 会话磁盘格式共享库 —— 标题行型提取 + 目录扫描,供 cli-* 插件与
 * workspace(钉选会话列表)消费。原居 kernel/diskSessions.ts,因 extractJsonlTitle
 * 内含 omp/pi/claude/codex 四家私有行型知识,违反「内核不理解 CLI 私有格式」
 * 铁律,2026-09-04 下沉至 cli-shared(kernel 不得 import plugins,无法反向引用)。
 *
 * 目录约定(slug 规则/根路径)由各 CLI 插件自己声明;本库只管
 * "jsonl 文件内容 → 标题 / CliDiskSession"的行型解析。
 */

import type { CliDiskSession } from "@kernel/cli";
import { ipc } from "@kernel/ipc";

/** 标题展示最大长度:超出截断补省略号。 */
const TITLE_MAX_CHARS = 60;
/**
 * 标题读头窗口(两段式):首条用户消息常是大段粘贴,单行可达十几 KB 到几 MB,
 * 浅窗会把该行截成坏行 → 兜底失效显示短码。浅窗 32KB 保扫描基线成本,不中再对
 * 少数文件补深窗一次(实测本机四族兜底覆盖 88-96%;残留为贴图 base64/空会话,
 * 本就无文本可取,短码是诚实兜底)。
 */
const TITLE_HEAD_BYTES = 32 * 1024;
const TITLE_HEAD_BYTES_DEEP = 256 * 1024;

/** 外部 JSON 逐层收窄:取 object 的 string 字段,缺失/异型返回 undefined。 */
function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** content 字段(string | [{type:"text"|"input_text",text}...]) → 首段纯文本;tool_result 等异型跳过。 */
function firstText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = (part as Record<string, unknown>).type;
    if (type !== "text" && type !== "input_text") continue;
    const text = stringField(part, "text");
    if (text) return text;
  }
  return undefined;
}

/** 标题归一:折叠空白 + 截断;XML 包装(<command-…/<system-reminder>…)不是用户语义,丢弃。 */
function normalizeTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed || collapsed.startsWith("<")) return undefined;
  return collapsed.length > TITLE_MAX_CHARS
    ? `${collapsed.slice(0, TITLE_MAX_CHARS)}…`
    : collapsed;
}
/**
 * 指令包装消息判定(实证):codex 把 AGENTS.md 全文包成首条 role:user 消息注入
 * (`# AGENTS.md instructions for <cwd>`),不是用户真实输入,跳过后继扫描。
 */
function isInstructionWrapper(text: string): boolean {
  return text.startsWith("# AGENTS.md instructions");
}

/**
 * jsonl 头部 → 展示标题(纯函数,可测)。四种 CLI 行型实证:
 * 1. omp:`{"type":"title",...}` 记录恒在首行(CLI 自动生成/覆写,最高优先);
 * 2. omp/pi:`{"type":"session",...,"title":"..."}` 行内字段;
 * 3. claude:`{"type":"summary","summary":"..."}` 行;
 * 4. 通用兜底:首条 role=user 消息文本
 *    (omp/pi type:"message"、claude type:"user"、codex type:"response_item")。
 * head 可能截断末行 → 逐行 try/catch,坏行跳过。
 */
export function extractJsonlTitle(head: string): string | undefined {
  let sessionFieldTitle: string | undefined;
  let summaryTitle: string | undefined;
  let firstUserTitle: string | undefined;
  for (const line of head.split("\n")) {
    if (!line.includes('"')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const type = stringField(event, "type");

    /* 1. omp title 记录(首行即真相,直接定案) */
    if (type === "title") {
      const title = normalizeTitle(stringField(event, "title"));
      if (title) return title;
      continue;
    }
    /* 2. session 行内 title 字段 */
    if (type === "session" && !sessionFieldTitle) {
      sessionFieldTitle = normalizeTitle(stringField(event, "title"));
      continue;
    }
    /* 3. claude summary 行 */
    if (type === "summary" && !summaryTitle) {
      summaryTitle = normalizeTitle(stringField(event, "summary"));
      continue;
    }
    /* 4. 首条用户消息(三种载体,取先到者) */
    if (firstUserTitle) continue;
    if (type === "message" || type === "user") {
      const message = (event as Record<string, unknown>).message;
      if (!message || typeof message !== "object") continue;
      if (stringField(message, "role") !== "user") continue;
      const text = firstText((message as Record<string, unknown>).content);
      if (text && isInstructionWrapper(text.trim())) continue;
      firstUserTitle = normalizeTitle(text);
      continue;
    }
    if (type === "response_item") {
      const payload = (event as Record<string, unknown>).payload;
      if (!payload || typeof payload !== "object") continue;
      if (stringField(payload, "type") !== "message") continue;
      if (stringField(payload, "role") !== "user") continue;
      const text = firstText((payload as Record<string, unknown>).content);
      if (text && isInstructionWrapper(text.trim())) continue;
      firstUserTitle = normalizeTitle(text);
    }
  }
  return sessionFieldTitle ?? summaryTitle ?? firstUserTitle;
}

/**
 * 读头取标题:浅窗不中再深窗补一次。omp/pi/claude/codex/qoder 的 listSessions
 * 与 workspace 置顶标题统一走此入口,读头窗口知识收敛在此,不再各家自带。
 */
export async function readHeadTitle(path: string): Promise<string | undefined> {
  const shallow = await ipc.fsReadHead(path, TITLE_HEAD_BYTES).catch(() => "");
  if (shallow) {
    const title = extractJsonlTitle(shallow);
    if (title) return title;
  }
  const deep = await ipc.fsReadHead(path, TITLE_HEAD_BYTES_DEEP).catch(() => "");
  return deep ? extractJsonlTitle(deep) : undefined;
}

export async function scanJsonlSessions(dir: string): Promise<CliDiskSession[]> {
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  /* 读头彼此独立,并发一次发出:会话库几百个文件时顺序 await 是可感知的卡顿源。 */
  const sessions = await Promise.all(
    files.map(async (f) => {
      // 2026-09-01T04-20-58-618Z_01a05b32-ea7a-738c-8a48-0d03dfef6824.jsonl
      const m = f.name.match(/_([0-9a-f-]{36})\.jsonl$/);
      if (!m) return null;
      const title = await readHeadTitle(f.path);
      return { id: m[1], modifiedAt: f.modifiedAt, path: f.path, title };
    }),
  );
  return sessions.filter((s) => s !== null);
}
