/**
 * 会话读头解析/缓存/批量化 —— 自 diskSessions 拆出(300 行铁则;批量化为
 * 2026-10-04 外网读头风暴收敛新增)。cli-shared 准入先例:omp/pi(scanJsonlSessions)
 * + claude/qoder(listSessions)≥2 个 cli-* 插件联合消费标题/身份解析与缓存;
 * readHeadsBatched 另有 codex(meta 窗)/grok(summary)/kimi(state.json)消费。
 *
 * 三层:
 * - 纯解析:extractJsonlTitle(四种 CLI 行型)+ 两段式读头窗口(浅窗不中深窗补);
 * - headCache(mtime):读头是 append-only 日志出生段,mtime 未变即复用;仅缓存
 *   非空结果,无标题文件每轮重读(追赶自动命名落盘);
 * - 批量 readHeadsBatched/readHeadMetasBatch:外网中继上逐文件读头 = N+1 RTT +
 *   桥 32 并发帽快拒(标题/会话缺列)+ 链路拥塞(invoke 15s 超时强断→重连风暴);
 *   chunk 串行发出,首扫多几个 RTT 换管道不被自家扫描流量掐死。
 */
import { ipc } from "@kernel/ipc";
import { parseClaudeFamilySessionHead, parsePiFamilySessionHead } from "./sessionIdentity";

/** 标题展示最大长度:超出截断补省略号。 */
const TITLE_MAX_CHARS = 60;
/**
 * 标题读头窗口(两段式):首条用户消息常是大段粘贴,单行可达十几 KB 到几 MB,
 * 浅窗覆盖绝大多数;深窗仅标题兜底,不常态化。
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

/** 标题归一:折叠空白 + 截断;XML 包装(<command-…/<system-reminder>…)不是用户语义,丢弃。
 * 无可读词(纯 ?/�/符号)同值丢弃:CLI 侧编码损坏或旧版模型垃圾输出落盘的标题,
 * 不能永久顶在会话列表上 —— 跳过后继 title 记录/消息兜底(同 omp words===0 拒收口径,
 * 2026-09-11 win 用户「标题全是问号」排查:本地英文 tiny 模型给中文起名采样出 ?????)。 */
function normalizeTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed || collapsed.startsWith("<")) return undefined;
  if (!/\p{L}|\p{N}/u.test(collapsed)) return undefined;
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

/**
 * 读头取标题 + 创建时刻(一次浅窗双解析,深窗仅标题兜底):身份解析窗(4KB/8KB)
 * ⊂ 标题浅窗 32KB,同一 buffer 各解一遍 —— 比对「标题一读 + 身份一读」每文件省一次
 * IPC;pi 族与 claude 族行型互斥(type:"session" vs sessionId 字段),试解顺序不歧义。
 * 创建时刻定死看板日历落位(resume 只刷 mtime,创建 timestamp 不动)。
 */
export async function readHeadSessionMeta(
  path: string,
): Promise<{ title?: string; createdAt?: number }> {
  const shallow = await ipc.fsReadHead(path, TITLE_HEAD_BYTES).catch(() => "");
  /* IPC 异型返回防御:契约是 string,但桩/封装层一旦返回对象,truthy 对象会
   * 直接送进 split 链炸掉整个 Promise.all —— 该工作区扫描全灭(2026-09-17 桩目检实证)。 */
  const head = typeof shallow === "string" ? shallow : "";
  const identity = head
    ? (parsePiFamilySessionHead(head) ?? parseClaudeFamilySessionHead(head))
    : null;
  let title = head ? extractJsonlTitle(head) : undefined;
  if (!title) {
    const deepRaw = await ipc.fsReadHead(path, TITLE_HEAD_BYTES_DEEP).catch(() => "");
    const deep = typeof deepRaw === "string" ? deepRaw : "";
    title = deep ? extractJsonlTitle(deep) : undefined;
  }
  return { title, createdAt: identity?.createdAt };
}

/**
 * 读头缓存:头内容是 append-only 日志的出生段,mtime 未变即复用解析产物,
 * 重扫收敛为 1 次 collect + 仅新/变文件读头。负结果缓存(2026-10-04 外网
 * 标题缺失根治):无标题/读失败也带 TTL 入池 —— 否则慢链路一波读头超时后
 * 每轮重扫全库重读,5s 命名追赶节奏放大成永久拥塞(真机实锤大桶标题全空)。
 * mtime 变化(自动命名落盘)立即失效;TTL 仅是「永不命名」的上限。上限防旁路
 * 消费者(claude/qoder 自有 list 循环)目录无限增长泄漏。
 */
const HEAD_CACHE_MAX = 8192;
/** 负结果缓存 TTL:窗内重扫免读(拥塞收敛);过窗追读一次。 */
const HEAD_NEG_TTL_MS = 5 * 60_000;
const headCache = new Map<string, { mtime: number; at: number; title?: string; createdAt?: number }>();

/** Cache hit judgment: mtime match AND (positive result OR negative result not expired); expired negative results are removed and treated as miss. */
function cacheHit(path: string, mtime: number) {
  const c = headCache.get(path);
  if (!c || c.mtime !== mtime) return null;
  if (c.title === undefined && c.createdAt === undefined && Date.now() - c.at > HEAD_NEG_TTL_MS) {
    headCache.delete(path);
    return null;
  }
  return c;
}

/** 缓存剪除:本目录已消失的文件条目;其他目录的条目归旁路消费者,不动。
 * 两侧分隔符先归一:Windows 下 dir 拼型 `/` 与 Rust collect 返回的 `\` 不一致,
 * 不归一则剪除恒 no-op(条目滞留到 FIFO 上限)。 */
export function pruneHeadCache(dir: string, livePaths: Set<string>): void {
  const prefix = (dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`).replace(/\\/g, "/");
  for (const p of [...headCache.keys()]) {
    if (p.replace(/\\/g, "/").startsWith(prefix) && !livePaths.has(p)) headCache.delete(p);
  }
}

/** Read-head to get title + creation moment, with mtime cache (see headCache note). */
export function readHeadSessionMetaCached(
  path: string,
  mtime: number,
): Promise<{ title?: string; createdAt?: number }> {
  const cached = cacheHit(path, mtime);
  if (cached) return Promise.resolve({ title: cached.title, createdAt: cached.createdAt });
  return readHeadSessionMeta(path).then((meta) => {
    storeHeadCache(path, mtime, meta.title, meta.createdAt);
    return meta;
  });
}

/** Read-head to get title, with mtime cache (shares pool headCache with readHeadSessionMetaCached):
 *  title is the birth segment of an append-only log, reuse if mtime unchanged; no title goes to negative-result cache, chase re-reads after TTL
 *  (same-pool semantics). Precedent: cli-codex list-scan title consumption (2026-09-30 daily log scan acceleration). */
export function readHeadTitleCached(path: string, mtime: number): Promise<string | undefined> {
  const cached = cacheHit(path, mtime);
  if (cached) return Promise.resolve(cached.title);
  return readHeadTitle(path).then((title) => {
    storeHeadCache(path, mtime, title, undefined);
    return title;
  });
}

/** Cache convergence point (single write point): positive results enter the pool immediately; negative results (no title/read failure) enter the pool with timestamp for TTL chase; FIFO upper bound prevents leak. */
function storeHeadCache(path: string, mtime: number, title: string | undefined, createdAt: number | undefined): void {
  if (headCache.size >= HEAD_CACHE_MAX) {
    const oldest = headCache.keys().next().value;
    if (oldest !== undefined) headCache.delete(oldest);
  }
  headCache.set(path, { mtime, at: Date.now(), title, createdAt });
}

/** 单次批量请求的响应字节预算(base64 过中继 +33%,768KB → ~1MB < 4MiB 帧上限)。 */
const REQUEST_BYTE_BUDGET = 768 * 1024;

/** 批量读头(下标对齐;读失败项 = 空串,与逐文件 catch 同语义):按预算分 chunk
 *  串行发出 —— 并发一次全发会复刻逐文件风暴(并发帽快拒 + 链路拥塞)。 */
export async function readHeadsBatched(paths: string[], bytes: number): Promise<string[]> {
  const perChunk = Math.max(1, Math.floor(REQUEST_BYTE_BUDGET / bytes));
  const out: string[] = [];
  for (let i = 0; i < paths.length; i += perChunk) {
    const chunk = paths.slice(i, i + perChunk);
    const heads = await ipc.fsReadHeads(chunk, bytes).catch(() => chunk.map(() => ""));
    out.push(...heads);
  }
  return out;
}

/**
 * 批量读头解析(标题+创建时刻),listSessions 消费(omp/pi/claude/qoder):
 * mtime 命中走缓存;misses 一次批量浅窗,无标题文件串行深窗兜底 —— 语义与
 * readHeadSessionMeta 逐文件版完全一致(身份 ⊂ 浅窗;深窗仅标题),缓存同池。
 */
export async function readHeadMetasBatch(
  files: { path: string; modifiedAt: number }[],
): Promise<{ title?: string; createdAt?: number }[]> {
  const misses = files.filter((f) => !cacheHit(f.path, f.modifiedAt));
  const heads = await readHeadsBatched(misses.map((m) => m.path), TITLE_HEAD_BYTES);
  const parsed = misses.map((f, i) => {
    const head = heads[i];
    const identity = head
      ? (parsePiFamilySessionHead(head) ?? parseClaudeFamilySessionHead(head))
      : null;
    return {
      path: f.path,
      mtime: f.modifiedAt,
      /* 浅窗读失败(空串)与真无标题同形:深窗只对「读到了但没标题」补读 ——
       * 读失败更大窗同样读不到,逐文件重试只是复刻风暴(外网大桶实锤)。 */
      shallowOk: head !== "",
      title: head ? extractJsonlTitle(head) : undefined,
      createdAt: identity?.createdAt,
    };
  });
  /* 深窗兜底批量化:仅浅窗成功且无标题的少数文件(同 readHeadSessionMeta 两段式)。 */
  const deepTargets = parsed.filter((p) => p.shallowOk && !p.title);
  if (deepTargets.length) {
    const deeps = await readHeadsBatched(deepTargets.map((p) => p.path), TITLE_HEAD_BYTES_DEEP);
    deepTargets.forEach((p, i) => {
      if (deeps[i]) p.title = extractJsonlTitle(deeps[i]);
    });
  }
  for (const p of parsed) storeHeadCache(p.path, p.mtime, p.title, p.createdAt);
  const byPath = new Map(parsed.map((p) => [p.path, { title: p.title, createdAt: p.createdAt }]));
  return files.map((f) => {
    const miss = byPath.get(f.path);
    if (miss) return miss;
    const cached = cacheHit(f.path, f.modifiedAt);
    return { title: cached?.title, createdAt: cached?.createdAt };
  });
}
