/**
 * 输入历史 store(kernel 通用原语)—— 记录提交过的提示词,供 ghost 补全与
 * 空输入 ↑↓ 召回;composer 插件(记录/召回/补全)与 settings 插件(管理区)联合消费,
 * 循 kernel/composerStage 先例入 kernel。
 * 逻辑等价移植 codemoss(desktop-cc-gui)prompt-history.ts;存储与订阅按 tmd-cli
 * 惯例重写:localStorage 单 key(纯 UI 态不进 settings schema,循 filePanel 惯例),
 * 变更事件走模块级 listener 集(循 drawerOpen 惯例)。
 *
 * 契约:
 * - items 最旧在前(newest-last);record 去重(同文本移到最底)并计数 +1;
 * - 上限 200 条,单条截断 300 字符;delete/clear 同步清计数;
 * - findPromptCompletion:前缀匹配(大小写不敏感)且比查询长,按使用次数降序、
 *   同次数取更短;查询 clean 后不足 2 字符返回 null。
 */

const STORAGE_KEY = "tmd.composer.promptHistory.v1";
const MAX_ITEMS = 200;
const MAX_TEXT_LENGTH = 300;

interface PromptHistoryData {
  items: string[];
  counts: Record<string, number>;
}

let cache: PromptHistoryData | null = null;
const listeners = new Set<() => void>();

/** 脏数据整体回落空表(node 测试环境无 Web Storage 同样回落)。 */
function load(): PromptHistoryData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as PromptHistoryData).items) &&
        (parsed as PromptHistoryData).items.every((v) => typeof v === "string") &&
        (parsed as PromptHistoryData).counts &&
        typeof (parsed as PromptHistoryData).counts === "object"
      ) {
        return parsed as PromptHistoryData;
      }
    }
  } catch {
    /* 落空表 */
  }
  return { items: [], counts: {} };
}

function get(): PromptHistoryData {
  if (!cache) cache = load();
  return cache;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get()));
  } catch {
    /* 存储不可用/写满不致命:内存态保留到本次会话 */
  }
  listeners.forEach((fn) => fn());
}

/** 全部记录,最旧在前(最新在末尾)。 */
export function getPromptHistory(): string[] {
  return get().items;
}

/** 记录一条提交(去重置底 + 计数);空串忽略。 */
export function recordPrompt(text: string): void {
  const entry = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!entry) return;
  const data = get();
  const existing = data.items.indexOf(entry);
  if (existing !== -1) data.items.splice(existing, 1);
  data.items.push(entry);
  while (data.items.length > MAX_ITEMS) data.items.shift();
  data.counts[entry] = (data.counts[entry] ?? 0) + 1;
  save();
}

/** 删除单条(连同计数)。 */
export function deletePrompt(text: string): void {
  const data = get();
  const index = data.items.indexOf(text);
  if (index === -1) return;
  data.items.splice(index, 1);
  delete data.counts[text];
  save();
}

/** 清空全部记录与计数。 */
export function clearPromptHistory(): void {
  cache = { items: [], counts: {} };
  save();
}

/** 设置页清单:文本 + 使用次数,最常用在前。 */
export function getPromptHistoryWithCounts(): { text: string; count: number }[] {
  const { items, counts } = get();
  return items
    .map((text) => ({ text, count: counts[text] ?? 1 }))
    .sort((a, b) => b.count - a.count);
}

/** 订阅变更(record/delete/clear 触发);返回退订函数。 */
export function subscribePromptHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

/** 最佳 ghost 补全:前缀匹配且比查询长;使用次数降序,同次数取更短。无则 null。 */
export function findPromptCompletion(query: string, minQueryLength = 2): string | null {
  const clean = query.replace(INVISIBLE_CHARS_RE, "").trim();
  if (clean.length < minQueryLength) return null;
  const lower = clean.toLowerCase();
  const { items, counts } = get();
  let best: string | null = null;
  for (const item of items) {
    if (item.length <= clean.length) continue;
    if (!item.toLowerCase().startsWith(lower)) continue;
    const count = counts[item] ?? 0;
    const bestCount = best !== null ? (counts[best] ?? 0) : -1;
    if (count > bestCount || (count === bestCount && best !== null && item.length < best.length)) {
      best = item;
    }
  }
  return best;
}

/** 测试注入:替换底层存储读取(仅测试消费)。 */
export function __setStorageForTest(raw: string | null): void {
  cache = null;
  if (raw === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, raw);
}
