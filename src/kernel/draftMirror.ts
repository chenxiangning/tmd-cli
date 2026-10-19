/**
 * 草稿镜像 —— 内存草稿的 localStorage 安全网(0.4.0 项 12)。
 *
 * 覆盖面 = 关窗/崩溃/强退时随进程蒸发的三类内存草稿:file(fileCache 内存
 * Map)/ journal 便签(组件态)/ ssh-file(无草稿缓存)。composer 与
 * structured 会话草稿已各自持久化,不在此列。
 *
 * 形制沿 mobile useDraft 先例:值键 + 写入时间台账(_ledger),TTL 7 天。
 * 键族 `tmd.draftMirror.<slot>`,slot 约定:`file:<path>` / `journal-note:<ymd>`
 * / `ssh-file:<path>`。草稿永远不进 settings(取舍先例:settings 存跨会话
 * 配置,草稿/UI 态走裸 localStorage;try/catch 静默兜隐私态与配额满)。
 *
 * 写路径防抖 300ms(useComposerDraft 同款节奏)+ 写穿缓存:set 即改内存
 * 快照,get 不等落盘;flushAll 供退出编排/关窗闸同帧补写。单条 256KB 超限
 * 截尾只留前缀(截断标记随条目返回,恢复条注明);台账 GC 摊销在写路径,
 * 过期惰性清理在 get,不依赖 boot 钩子。
 */

const PREFIX = "tmd.draftMirror.";
/** 写入时间台账(键清单 + 老化清理信号,仿 mobile useDraft)。 */
const LEDGER_KEY = "tmd.draftMirror._ledger";
/** 草稿保留期:超期未再编辑即老化清除(数日不动视为放弃)。 */
const TTL_MS = 7 * 24 * 3600 * 1000;
/** 单条上限:超限截尾只留前缀,防单份大稿吃穿配额拖垮整族镜像。 */
const MAX_CHARS = 256 * 1024;
/** 防抖:编辑流不逐键打 localStorage。 */
const DEBOUNCE_MS = 300;

/** 台账条目:纯时间戳,或带截断标记(截断标记须跨重启存活,随台账走)。 */
type LedgerEntry = number | { t: number; cut?: 1 };

export interface DraftMirrorEntry {
  text: string;
  /** 最后一次落盘时间(台账;缺失按 0 = 过期不可用)。 */
  savedAt: number;
  /** 原稿超限被截断(恢复条注明「仅保留前缀」)。 */
  truncated: boolean;
}

/** setTimeout 句柄跨端类型(DOM=number / node=Timeout):以 clearTimeout 参数面为准。 */
type TimerHandle = Parameters<typeof clearTimeout>[0];

/** 写穿缓存:set 即生效,get 不等防抖落盘;flushAll 据此同帧补写。 */
const pending = new Map<string, string>();
/** set 时刻(缓存态条目的 savedAt;落盘成功后以台账为准并清除)。 */
const pendingAt = new Map<string, number>();
const timers = new Map<string, TimerHandle>();

function readLedger(): Record<string, LedgerEntry> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, LedgerEntry>;
  } catch {
    return {}; /* 脏 JSON:按无台账处理,get 侧惰性清掉孤儿值 */
  }
}

function writeLedger(map: Record<string, LedgerEntry>): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(map));
  } catch {
    /* 隐私态 */
  }
}

function entryAt(ledger: Record<string, LedgerEntry>, slot: string): { ts: number; cut: boolean } {
  const v = ledger[slot];
  if (typeof v === "number") return { ts: v, cut: false };
  return { ts: v?.t ?? 0, cut: v?.cut === 1 };
}

/** 摘除一个槽:内存快照、在途防抖、值键、台账条目一次清干净。 */
function removeSlot(slot: string): void {
  pending.delete(slot);
  pendingAt.delete(slot);
  const timer = timers.get(slot);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(slot);
  }
  try {
    localStorage.removeItem(PREFIX + slot);
  } catch {
    /* 隐私态 */
  }
  const ledger = readLedger();
  if (slot in ledger) {
    delete ledger[slot];
    writeLedger(ledger);
  }
}

/** 把内存快照落盘(截断 + 台账记账 + 顺手 GC 超期他槽)。 */
function writeThrough(slot: string): void {
  const text = pending.get(slot);
  if (text === undefined) return;
  const cut = text.length > MAX_CHARS;
  try {
    localStorage.setItem(PREFIX + slot, cut ? text.slice(0, MAX_CHARS) : text);
  } catch {
    return; /* 配额满/隐私态:静默放弃本轮落盘,内存快照照常(下次 flush 重试) */
  }
  pendingAt.delete(slot);
  const now = Date.now();
  const ledger = readLedger();
  ledger[slot] = cut ? { t: now, cut: 1 } : now;
  /* 台账 GC 摊销在写路径:超期他槽值键+台账一起清。 */
  for (const key of Object.keys(ledger)) {
    const ts = typeof ledger[key] === "number" ? (ledger[key] as number) : entryAt(ledger, key).ts;
    if (key !== slot && now - ts > TTL_MS) {
      delete ledger[key];
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {
        /* 隐私态 */
      }
    }
  }
  writeLedger(ledger);
}

/** 记一版草稿镜像(防抖落盘;内存快照即时生效)。 */
export function draftMirrorSet(slot: string, text: string): void {
  pending.set(slot, text);
  pendingAt.set(slot, Date.now());
  if (timers.has(slot)) return;
  timers.set(
    slot,
    setTimeout(() => {
      timers.delete(slot);
      writeThrough(slot);
    }, DEBOUNCE_MS),
  );
}

/**
 * 读镜像:内存快照优先;无则回读存储并做 TTL 惰性清理
 * (过期即摘除并返回 null;缓存态是正在编辑的活稿,不存在过期)。
 */
export function draftMirrorGet(slot: string): DraftMirrorEntry | null {
  let text = pending.get(slot);
  let fromStorage = false;
  if (text === undefined) {
    try {
      text = localStorage.getItem(PREFIX + slot) ?? undefined;
    } catch {
      return null; /* 隐私态 */
    }
    if (text === undefined) return null;
    fromStorage = true;
  }
  const { ts, cut } = entryAt(readLedger(), slot);
  const savedAt = ts || pendingAt.get(slot) || 0;
  if (Date.now() - savedAt > TTL_MS) {
    if (fromStorage) removeSlot(slot);
    return null;
  }
  const truncated = cut || text.length > MAX_CHARS;
  return { text: truncated ? text.slice(0, MAX_CHARS) : text, savedAt, truncated };
}

/** 清镜像(草稿已保存/用户确认丢弃时与既有草稿清除同点调用)。 */
export function draftMirrorClear(slot: string): void {
  removeSlot(slot);
}

/** 同帧补写全部在途防抖(退出编排/关窗闸先行调用;同步,无待落盘遗留)。 */
export function draftMirrorFlushAll(): void {
  for (const slot of [...pending.keys()]) {
    const timer = timers.get(slot);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(slot);
    }
    writeThrough(slot);
  }
}
