/**
 * agent wiki 纯逻辑 —— 类型 / 解析 / 序列化 / 幂等追加 / 摘录截取。
 *
 * 存储 = 工作区 <root>/.tmd/wiki.json 单文件;条目三类:
 * auto(会话退出钩子写入的待归类摘录)/ decision(已决策)/ open(开放问题)。
 * auto 由退出钩子写入,人工改类/删;幂等 = 一会话生命周期只写一条 auto。
 */

/** wiki 条目(kind 语义见文件头注)。 */
export interface WikiEntry {
  /** 短随机 id(追加时生成)。 */
  id: string;
  /** 写入时刻 ms epoch。 */
  ts: number;
  /** 来源引擎档案 id(如 omp/claude/codex;展示用)。 */
  harness: string;
  /** 来源会话 id(auto 幂等 key 的一半)。 */
  sessionId: string;
  /** 用户消息尾段摘录(≤800 字)。 */
  excerpt: string;
  kind: "auto" | "decision" | "open";
}

/** 磁盘文档形态;version 不符按空文档处理(不迁移,人工处置)。 */
export interface WikiDoc {
  version: 1;
  entries: WikiEntry[];
}

/** auto 条目摘录上限(字符)。 */
const EXCERPT_MAX = 800;

/** 生成短随机 id(无依赖;碰撞面 = 同毫秒同随机段,可忽略)。 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 条目最小形状守卫:人工手改丢 id / kind 拼坏的条目直接弃(防 React key
 * undefined 与「计入总数却三栏都不显」的幽灵条目)。 */
function entryOk(e: unknown): e is WikiEntry {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id !== "" &&
    typeof o.ts === "number" &&
    Number.isFinite(o.ts) &&
    typeof o.harness === "string" &&
    typeof o.sessionId === "string" &&
    typeof o.excerpt === "string" &&
    (o.kind === "auto" || o.kind === "decision" || o.kind === "open")
  );
}

/** 解析磁盘文本;坏 JSON / version≠1 / 条目形状不合法 → 丢弃或空文档,绝不抛。 */
export function parseWikiDoc(text: string): WikiDoc {
  try {
    const raw = JSON.parse(text) as { version?: unknown; entries?: unknown };
    if (raw?.version !== 1 || !Array.isArray(raw.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: raw.entries.filter(entryOk) };
  } catch {
    return { version: 1, entries: [] };
  }
}

/** 序列化(两空格缩进,便于人工查看/手改)。 */
export function serializeWikiDoc(doc: WikiDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** 条目上限:超过后从最旧剪 auto 条目(decision/open 是人工拍板,保留)。 */
const ENTRIES_MAX = 500;

/** 幂等追加:同 sessionId 的 auto 条目已存在则原样返回(一会话生命周期只写一次);
 * 总量超限剪最旧 auto(decision/open 不动)。 */
export function addEntry(doc: WikiDoc, entry: Omit<WikiEntry, "id">): WikiDoc {
  if (
    entry.kind === "auto" &&
    doc.entries.some((e) => e.kind === "auto" && e.sessionId === entry.sessionId)
  ) {
    return doc;
  }
  let entries = [...doc.entries, { ...entry, id: newId() }];
  if (entries.length > ENTRIES_MAX) {
    const keep: typeof entries = [];
    let overflow = entries.length - ENTRIES_MAX;
    for (const e of entries) {
      if (overflow > 0 && e.kind === "auto") {
        overflow -= 1;
        continue;
      }
      keep.push(e);
    }
    entries = keep;
  }
  return { version: 1, entries };
}

/** 用户消息尾段摘录:取尾段拼接,截 800 字(保尾部 —— 越靠后越接近结论)。 */
export function excerptFromMsgs(msgs: { text: string }[]): string {
  const tail = (msgs ?? [])
    .slice(-10)
    .map((m) => m.text)
    .join("\n---\n");
  return tail.slice(-EXCERPT_MAX);
}

export { EXCERPT_MAX, newId };
