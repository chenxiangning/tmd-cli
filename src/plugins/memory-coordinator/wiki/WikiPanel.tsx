/**
 * agent wiki 面板(registerTabContent,kind="agent-wiki")。
 *
 * 双栏(已决策 / 开放问题)+ 待归类段;auto 条目人工改类或删,
 * decision/open 可删;顶部支持手动沉淀一句话。存储 = 当前工作区
 * <root>/.tmd/wiki.json,读改写全走 ipc;目录缺失先建再写。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { formatDate, formatTime } from "@kernel/relativeTime";
import { ipc } from "@kernel/ipc";
import { Empty } from "@kernel/Empty";
import { addEntry, isMissingReadErr, parseWikiDoc, serializeWikiDoc, type WikiDoc, type WikiEntry } from "./wiki";
import { wikiFilePath, withWikiLock, WIKI_BEAT_KEY } from "./wikiHook";
import { harnessLabel } from "../protocol";

type Kind = WikiEntry["kind"];

async function persistDoc(root: string, doc: WikiDoc): Promise<void> {
  const path = wikiFilePath(root);
  try {
    await ipc.fsWriteFile(path, serializeWikiDoc(doc));
  } catch {
    await ipc.fsCreateDir(`${root}/.tmd`).catch(() => undefined);
    /* 二次失败向上抛,由调用方 toast(乐观上屏不许静默分叉)。 */
    await ipc.fsWriteFile(path, serializeWikiDoc(doc));
  }
}

/** 读盘:文件缺失(含 .tmd 目录缺失)= 空文档起步;其他读错误向上抛
 *  (环境抖动时以空库为基线落盘会清空整个 wiki,禁止)。 */
async function loadDoc(root: string): Promise<WikiDoc> {
  let text: string;
  try {
    text = await ipc.fsReadFile(wikiFilePath(root));
  } catch (e) {
    if (isMissingReadErr(String(e))) return { version: 1, entries: [] };
    throw e;
  }
  return parseWikiDoc(text);
}

/** 单条目行:两行截断摘要(title 全文)+ 徽标 + 日期 + 按钮组。 */
function EntryRow({
  e,
  onKind,
  onDelete,
}: {
  e: WikiEntry;
  onKind: (k: Kind) => void;
  onDelete: () => void;
}) {
  const btn =
    "shrink-0 rounded border border-(--tmd-border) px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:text-(--tmd-fg) hover:border-(--tmd-fg-muted)";
  return (
    <div className="flex items-start gap-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div
          className="line-clamp-2 break-all text-xs leading-relaxed text-(--tmd-fg)"
          title={e.excerpt}
        >
          {e.excerpt}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-(--tmd-fg-muted)">
          <span className="rounded bg-(--tmd-border) px-1 py-px font-mono">{harnessLabel(e.harness)}</span>
          <span>{formatDate(e.ts)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {e.kind === "auto" && (
          <>
            <button type="button" className={btn} onClick={() => onKind("decision")}>
              {t("标为已决策")}
            </button>
            <button type="button" className={btn} onClick={() => onKind("open")}>
              {t("标为开放问题")}
            </button>
          </>
        )}
        <button type="button" className={btn} onClick={onDelete}>
          {t("删除条目")}
        </button>
      </div>
    </div>
  );
}

export function WikiPanel() {
  const { list, activeId } = useWorkspaces();
  const ws = list.find((w) => w.id === activeId) ?? null;
  const root = ws?.root ?? "";
  const [doc, setDoc] = useState<WikiDoc | null>(null); /* null = 未读 */
  const [loadFailed, setLoadFailed] = useState(false); /* 非缺失读错误:停失败态待重试 */
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((m: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const reload = useCallback((): void => {
    if (!root) return;
    setLoadFailed(false);
    void loadDoc(root)
      .then((d) => setDoc(d))
      .catch(() => {
        /* 非缺失读错误(环境抖动):停失败态并如实告知,不以空库续写;可重试。 */
        setDoc(null);
        setLoadFailed(true);
      });
  }, [root]);

  useEffect(() => {
    setDoc(null);
    setDraft(""); /* 草稿不跨工作区残留:切区即清,防写错工作区。 */
    setLoadFailed(false);
    if (!root) return;
    reload();
    /* 钩子落盘后即时刷新(host.events 同通道,与 autoDistill 同一总线约定);
     * storage 事件 = 另一窗写盘广播(WIKI_BEAT_KEY),重读对齐。 */
    const off = host.events.on<{ cwd?: string }>("memory-coordinator.wiki.updated", (p) => {
      if (p?.cwd && p.cwd !== root) return;
      reload();
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIKI_BEAT_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      off();
      window.removeEventListener("storage", onStorage);
    };
  }, [root, reload]);

  useEffect(() => () => {
    /* 卸载清 toast 定时器(悬空 setState 无害但不留尾巴)。 */
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  /* 读改写过 withWikiLock(与钩子同一队列):基于锁内最新盘上档套用变更,
   * 消面板/钩子互相盲写覆盖;乐观上屏先给,读/写失败 toast 并以盘上档校正。 */
  const mutate = useCallback(
    (fn: (d: WikiDoc) => WikiDoc) => {
      if (!root || !doc) return;
      setDoc(fn(doc));
      void withWikiLock(async () => {
        const cur = await loadDoc(root); /* 非缺失读错误向上抛,不以空库续写。 */
        const next = fn(cur);
        await persistDoc(root, next);
        setDoc(next);
        /* 双窗同步:本窗走 host.events,另一窗经 storage beat 重读。 */
        host.events.emit("memory-coordinator.wiki.updated", { cwd: root });
        try {
          localStorage.setItem(WIKI_BEAT_KEY, JSON.stringify({ cwd: root, ts: Date.now() }));
        } catch {
          /* 存储不可达时静默(单窗场景不受影响)。 */
        }
        void ipc.gitEnsureLocalExclude(root, ".tmd/").catch(() => undefined);
      }).catch(() => {
        showToast(t("读写失败,改动可能未保存"));
        void loadDoc(root)
          .then((d) => setDoc(d))
          .catch(() => undefined); /* 校正重读再失败:保持乐观态,下次操作再试。 */
      });
    },
    [root, doc, showToast],
  );

  const setKind = (id: string, kind: Kind) =>
    mutate((d) => ({
      version: 1,
      entries: d.entries.map((e) => (e.id === id ? { ...e, kind } : e)),
    }));
  const remove = (id: string) =>
    mutate((d) => ({ version: 1, entries: d.entries.filter((e) => e.id !== id) }));

  const addManual = (kind: Kind) => {
    const text = draft.trim();
    if (!text || !root || !doc) return; /* doc 未加载:mutate 会早退,草稿不清防丢稿。 */
    /* sessionId 对 manual 无幂等语义,置占位(不塞全文,免双份存储)。 */
    mutate((d) => addEntry(d, { ts: Date.now(), harness: "manual", sessionId: "manual", excerpt: text, kind }));
    setDraft("");
  };

  if (!ws)
    return (
      <div className="h-full">
        <Empty>{t("未选择工作区")}</Empty>
      </div>
    );

  const entries = doc?.entries ?? [];
  const autos = entries.filter((e) => e.kind === "auto");
  const decisions = entries.filter((e) => e.kind === "decision");
  const opens = entries.filter((e) => e.kind === "open");
  const lastAutoTs = autos.length ? Math.max(...autos.map((e) => e.ts)) : null;

  const column = (label: string, rows: WikiEntry[]) => (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="text-xs font-semibold text-(--tmd-fg-muted)">
        {label} · {rows.length}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {rows.map((e) => (
          <EntryRow key={e.id} e={e} onKind={(k) => setKind(e.id, k)} onDelete={() => remove(e.id)} />
        ))}
        {!rows.length && <div className="px-1 text-xs text-(--tmd-fg-muted)">{t("暂无")}</div>}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--tmd-border) p-2.5 text-xs">
        <span className="text-(--tmd-fg-muted)">
          {t("上次沉淀 {time}", { time: lastAutoTs ? formatTime(lastAutoTs) : "—" })}
        </span>
        <span className="text-(--tmd-fg-muted)">{t("共 {count} 条", { count: entries.length })}</span>
        <button
          type="button"
          className="rounded border border-(--tmd-border) px-1.5 py-0.5 font-mono text-[11px] text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => showToast(wikiFilePath(root))}
          title={wikiFilePath(root)}
        >
          .tmd/wiki.json
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-(--tmd-border) p-2.5">
        <input
          className="h-7 min-w-0 flex-1 rounded border border-(--tmd-border) bg-transparent px-2 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-fg-muted)"
          placeholder={t("手动沉淀一句话…")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return; /* IME 选词 Enter 不触发提交。 */
            if (e.key === "Enter") addManual("decision");
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => addManual("decision")}
        >
          {t("加为已决策")}
        </button>
        <button
          type="button"
          className="shrink-0 rounded border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => addManual("open")}
        >
          {t("加为开放问题")}
        </button>
      </div>
      {doc === null ? (
        loadFailed ? (
          <div className="flex items-center gap-2 p-3 text-xs text-(--tmd-fg-muted)">
            {t("读取 wiki 失败")}
            <button
              type="button"
              className="rounded border border-(--tmd-border) px-1.5 py-0.5 hover:text-(--tmd-fg)"
              onClick={reload}
            >
              {t("重试")}
            </button>
          </div>
        ) : (
          <div className="p-3 text-xs text-(--tmd-fg-muted)">{t("加载中…")}</div>
        )
      ) : !entries.length ? (
        <div className="h-full">
          <Empty>{t("本工作区还没有 wiki 条目;会话退出时会自动沉淀用户消息尾段")}</Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2.5">
          {column(t("待归类(自动沉淀)"), autos)}
          <div className="flex min-h-40 flex-1 gap-3">
            {column(t("已决策"), decisions)}
            {column(t("开放问题"), opens)}
          </div>
        </div>
      )}
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-(--tmd-bg-elevated) px-3 py-1.5 text-xs text-(--tmd-fg) shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}
