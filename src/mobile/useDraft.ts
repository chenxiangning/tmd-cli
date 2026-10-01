/**
 * 会话草稿持久化(localStorage,按 sessionId)—— 返回 home 卸载会话屏不再
 * 丢未发文字(mount 恢复 / 输入即存 / 发送成功清除)。
 * 挂图不持久化:temp 文件生命周期不可靠(系统回收后路径悬空),误恢复比
 * 丢失更糟;挂图仍随页面卸载丢弃。
 */
import { useEffect, useState } from "react";

function draftKey(sessionId: string): string {
  return `tmd.draft.${sessionId}`;
}

/** 写入时间台账(键清单 + 老化清理用):会话删除后草稿键不再有任何引用方,
 *  台账是唯一的可清理信号;按年龄老化,不赌会话列表完整性(列表是异步加载,
 *  首屏判存在会误删尚未到达的会话草稿)。 */
const LEDGER_KEY = "tmd.draft._ledger";
/** 草稿保留期:超期未再编辑即老化清除(草稿即未发意图,数日不动视为放弃)。 */
const DRAFT_TTL_MS = 7 * 24 * 3600 * 1000;

function readLedger(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeLedger(map: Record<string, number>): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(map));
  } catch {
    /* 隐私态 */
  }
}

/** 老化清理:挂载期调一次,清超期草稿键。 */
export function pruneDrafts(): void {
  const ledger = readLedger();
  const now = Date.now();
  let dirty = false;
  for (const id of Object.keys(ledger)) {
    if (now - ledger[id] <= DRAFT_TTL_MS) continue;
    dirty = true;
    delete ledger[id];
    try {
      localStorage.removeItem(draftKey(id));
    } catch {
      /* 隐私态 */
    }
  }
  if (dirty) writeLedger(ledger);
}

function readDraft(sessionId: string): string {
  try {
    return localStorage.getItem(draftKey(sessionId)) ?? "";
  } catch {
    return ""; /* 隐私态 */
  }
}

function writeDraft(sessionId: string, value: string): void {
  try {
    localStorage.setItem(draftKey(sessionId), value);
  } catch {
    /* 隐私态:内存态照常,只是不落盘 */
    return;
  }
  const ledger = readLedger();
  ledger[sessionId] = Date.now();
  writeLedger(ledger);
}

export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* 隐私态 */
  }
  const ledger = readLedger();
  if (sessionId in ledger) {
    delete ledger[sessionId];
    writeLedger(ledger);
  }
}

export function useDraft(sessionId: string): {
  draft: string;
  setDraft: (v: string) => void;
  clear: () => void;
} {
  const [draft, setDraftState] = useState(() => readDraft(sessionId));
  /* 会话切换(组件复用)时重读对应草稿。 */
  useEffect(() => {
    setDraftState(readDraft(sessionId));
  }, [sessionId]);
  const setDraft = (v: string): void => {
    setDraftState(v);
    writeDraft(sessionId, v);
  };
  const clear = (): void => {
    setDraftState("");
    clearDraft(sessionId);
  };
  return { draft, setDraft, clear };
}
