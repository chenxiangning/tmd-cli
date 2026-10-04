/**
 * 会话读头解析/缓存/批量化 —— 自 diskSessions 拆出(300 行铁则;批量化为
 * 2026-10-04 外网读头风暴收敛新增)。cli-shared 准入先例:omp/pi(scanJsonlSessions)
 * + claude/qoder(listSessions)≥2 个 cli-* 插件联合消费标题/身份解析与缓存;
 * readHeadsBatched 另有 codex(meta 窗)/grok(summary)/kimi(state.json)消费。
 *
 * 三层:
 * - 纯解析:extractJsonlTitle(四种 CLI 行型)+ 两段式读头窗口(浅窗不中深窗补);
 * - headCache(mtime):读头是 append-only 日志出生段,mtime 未变即复用;读成功
 *   但无标题 = 负结果带 TTL 入池(拥塞收敛),读失败不入池下轮重试(启动/重连
 *   桥未就绪波的恢复路径,毒化整桶标题的回归根因);
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
 * 读头缓存:头内容是 append-only 日志的出生段,mtime 未变即复用解析产物,
 * 重扫收敛为 1 次 collect + 仅新/变文件读头。负结果缓存(2026-10-04 外网
 * 标题缺失根治)仅限「读成功但无标题」:带 TTL 入池,否则慢链路一波读头超时
 * 后每轮重扫全库重读,5s 命名追赶节奏放大成永久拥塞(真机实锤大桶标题全空);
 * mtime 变化(自动命名落盘)立即失效,TTL 兜「永不命名」上限。**读失败(空串)
 * 不入池**:启动/重连桥未就绪波整桶读失败若入池 = 5 分钟标题毒化(行落 id
 * 兜底实锤),不缓存则下轮自然重试恢复。上限防旁路消费者目录无限增长泄漏。
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

/** 缓存收口(单写点):readOk = 读头真读到了(非空串);读成功才落池(正结果立即
 * 复用,无标题负结果带 TTL 追读),读失败不落池下轮重试(恢复路径)。FIFO 上限防泄漏。 */
function storeHeadCache(
  path: string,
  mtime: number,
  readOk: boolean,
  title: string | undefined,
  createdAt: number | undefined,
): void {
  if (!readOk) {
    headCache.delete(path);
    return;
  }
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
    /* IPC 异型返回防御(2026-09-17 桩目检实证同款):契约是 string[],但桩/
     * 封装层一旦回对象元素,truthy 值直进 split 链会炸掉整桶扫描——元素级
     * 异型按读失败空串归一;整体非数组逐下标补空串,保下标对齐。 */
    const heads: unknown[] = await ipc.fsReadHeads(chunk, bytes).catch(() => []);
    for (let j = 0; j < chunk.length; j++) {
      const h = heads[j];
      out.push(typeof h === "string" ? h : "");
    }
  }
  return out;
}

/**
 * 批量读头解析(标题+创建时刻),listSessions 消费(omp/pi/claude/qoder):
 * mtime 命中走缓存;misses 一次批量浅窗,「浅窗成功但无标题」批量化深窗兜底 ——
 * 语义与逐文件两段式一致(身份 ⊂ 浅窗;深窗仅标题),缓存同池。
 * readOk(读成功才落池)随两段式传播:浅窗失败或深窗补读失败 = 不入池下轮重试。
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
      readOk: head !== "",
      title: head ? extractJsonlTitle(head) : undefined,
      createdAt: identity?.createdAt,
    };
  });
  /* 深窗兜底批量化:仅浅窗成功且无标题的少数文件(同两段式窗口语义)。 */
  const deepTargets = parsed.filter((p) => p.readOk && !p.title);
  if (deepTargets.length) {
    const deeps = await readHeadsBatched(deepTargets.map((p) => p.path), TITLE_HEAD_BYTES_DEEP);
    deepTargets.forEach((p, i) => {
      p.readOk = deeps[i] !== "";
      if (deeps[i]) p.title = extractJsonlTitle(deeps[i]);
    });
  }
  for (const p of parsed) storeHeadCache(p.path, p.mtime, p.readOk, p.title, p.createdAt);
  const byPath = new Map(parsed.map((p) => [p.path, { title: p.title, createdAt: p.createdAt }]));
  return files.map((f) => {
    const miss = byPath.get(f.path);
    if (miss) return miss;
    const cached = cacheHit(f.path, f.modifiedAt);
    return { title: cached?.title, createdAt: cached?.createdAt };
  });
}
