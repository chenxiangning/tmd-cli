/**
 * 规则体检报告 · 历史区(扫描记录 + 应用记录)。
 * 扫描记录 = 每次体检一条(时间/口径/统计/引擎);应用记录 = 每次保存之前与
 * 之后的内容(diff 回看 + 撤销)。数据自 lintStore,随结果时间戳变化重载。
 */

import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { loadStore, type LintStoreData } from "./lintStore";
import { applyUndoRecord } from "./lintActions";
import { DiffPreview } from "./LintRows";
import { diffLines } from "./diffUtil";
import type { ApplyRecord } from "./lintTypes";

const HEAD_CLS =
  "border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-1 text-meta font-medium text-(--tmd-fg-muted)";

function day(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** 扫描记录列表(每次体检一条)。 */
export function ScanHistory({ revision, cwd }: { revision: number; cwd: string | null }) {
  const [data, setData] = useState<LintStoreData | null>(null);
  useEffect(() => {
    void loadStore().then(setData);
  }, [revision]);
  const rows = (data?.scanHistory ?? []).filter((r) => (cwd ? r.cwd === cwd : true));
  return (
    <div>
      <div className={HEAD_CLS}>{t("扫描记录")}({rows.length})</div>
      {rows.map((r) => (
        <div key={`${r.at}:${r.engineId}:${r.rules}`} className="flex items-center gap-3 px-3 py-1 text-meta text-(--tmd-fg-muted)">
          <span className="flex-none font-mono">{day(r.at)}</span>
          <span className="flex-none">{r.cwd.split("/").pop()}</span>
          <span>
            {t("{f} 文件 · {r} 规则 · 判定 {j}/{n} · 发现 {d}", {
              f: String(r.files), r: String(r.rules), j: String(r.judged), n: String(r.rules), d: String(r.findings),
            })}
          </span>
          <span className="ml-auto flex-none truncate font-mono text-(--tmd-fg-faint)">
            {r.engineError || `${r.engineId}${r.model ? `:${r.model}` : ""}`}
          </span>
        </div>
      ))}
      {rows.length === 0 && <div className="px-3 py-2 text-meta text-(--tmd-fg-faint)">{t("还没有扫描记录")}</div>}
    </div>
  );
}

/** 应用记录(保存前后内容 diff 回看 + 撤销)。 */
export function ApplyJournal({ revision, onError }: { revision: number; onError: (m: string) => void }) {
  const [data, setData] = useState<LintStoreData | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    void loadStore().then(setData);
  }, [revision]);
  const rows = data?.applyJournal ?? [];
  const undo = (rec: ApplyRecord) => {
    setBusy(true);
    void applyUndoRecord(rec).then((r) => {
      setBusy(false);
      if (r.ok) void loadStore().then(setData);
      else onError(r.note);
    });
  };
  return (
    <div>
      <div className={HEAD_CLS}>{t("应用记录(保存前 → 保存后)")}({rows.length})</div>
      {rows.map((r) => {
        const id = `${r.at}:${r.path}`;
        const open = openId === id;
        return (
          <div key={id} className="px-3 py-1">
            <div className="flex items-center gap-3 text-meta text-(--tmd-fg-muted)">
              <button type="button" onClick={() => setOpenId(open ? null : id)} className="min-w-0 flex-1 truncate text-left hover:text-(--tmd-accent)">
                <span className="font-mono">{day(r.at)}</span> · {r.kind} · <span className="font-mono">{r.path}</span>
              </button>
              <button type="button" disabled={busy} onClick={() => undo(r)} className="flex-none rounded border border-(--tmd-border) px-2 py-0.5 hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50">
                {busy ? <Spinner /> : t("撤销")}
              </button>
            </div>
            {open && <DiffPreview lines={diffLines(r.before, r.after)} />}
          </div>
        );
      })}
      {rows.length === 0 && <div className="px-3 py-2 text-meta text-(--tmd-fg-faint)">{t("还没有应用记录;每次体检后的修改都会记在这里")}</div>}
    </div>
  );
}
