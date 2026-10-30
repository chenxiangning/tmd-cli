/**
 * 规则体检报告 · 历史区(扫描记录 + 应用记录,可展开详情)。
 * 扫描记录 = 每次体检一条(时间/口径/统计/引擎 + 展开后的体检说明与记录设计);
 * 应用记录 = 每次保存之前与之后的内容(diff 回看 + 撤销 + 写回安全说明)。
 * 数据自 lintStore,随结果时间戳变化重载。
 */

import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { loadStore, type LintStoreData } from "./lintStore";
import { applyUndoRecord } from "./lintActions";
import { VERDICT_LABEL } from "./lintTypes";
import { DiffPreview } from "./LintRows";
import { diffLines } from "./diffUtil";
import type { ApplyRecord, ScanRecord } from "./lintTypes";

const HEAD_CLS =
  "border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-1 text-meta font-medium text-(--tmd-fg-muted)";

const KV_CLS = "grid grid-cols-[92px_minmax(0,1fr)] gap-2 py-0.5 text-meta";
const KV_DT_CLS = "text-(--tmd-fg-faint)";
const KV_DD_CLS = "min-w-0 break-all text-(--tmd-fg-muted)";

function day(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** 扫描记录展开详情:体检说明 + 口径键值 + 记录设计说明(旧记录缺字段降级)。 */
function ScanDetail({ r }: { r: ScanRecord }) {
  const unknown = "—";
  return (
    <div className="space-y-2 border-l-2 border-(--tmd-border) px-3 pb-2 pt-1 text-meta leading-relaxed">
      <p className="text-(--tmd-fg-muted)">
        {t("本次体检扫描 {f} 个规则文件、提取 {r} 条规则,完成判定 {j} 条;AI 不可识别 {b} 条。", {
          f: String(r.files), r: String(r.rules), j: String(r.judged), b: r.aiBad === undefined ? unknown : String(r.aiBad),
        })}
      </p>
      <dl>
        <div className={KV_CLS}><dt className={KV_DT_CLS}>{t("工作目录")}</dt><dd className={KV_DD_CLS}>{r.cwd}</dd></div>
        <div className={KV_CLS}><dt className={KV_DT_CLS}>{t("引擎/模型")}</dt><dd className={KV_DD_CLS}>{`${r.engineId}${r.model ? `:${r.model}` : ""}`}</dd></div>
        <div className={KV_CLS}>
          <dt className={KV_DT_CLS}>{t("会话语料")}</dt>
          <dd className={KV_DD_CLS}>
            {r.corpusMsgs === undefined ? unknown : t("{m} 条消息 / {s} 个会话", { m: String(r.corpusMsgs), s: String(r.corpusSessions ?? 0) })}
          </dd>
        </div>
        <div className={KV_CLS}><dt className={KV_DT_CLS}>{t("判定失败")}</dt><dd className={KV_DD_CLS}>{String(r.failed)}</dd></div>
        <div className={KV_CLS}><dt className={KV_DT_CLS}>{t("静态发现")}</dt><dd className={KV_DD_CLS}>{String(r.findings)}</dd></div>
      </dl>
      {r.engineError && <p className="text-(--tmd-error)">{r.engineError}</p>}
      {r.rows && r.rows.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-(--tmd-accent)">{t("规则执行结果({n} 条)", { n: String(r.rows.length) })}</summary>
          <div className="mt-1.5 max-h-72 space-y-1 overflow-y-auto pr-1">
            {r.rows.map((row) => (
              <div key={`${row.file}:${row.line}`} className="flex items-start gap-2 rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1.5">
                <span className={`mt-0.5 flex-none rounded px-1.5 py-0.5 text-[10px] ${
                  row.verdict === "working" ? "bg-(--tmd-ok)/10 text-(--tmd-ok)"
                    : row.verdict === "violated" ? "bg-(--tmd-error)/10 text-(--tmd-error)"
                      : row.verdict === "dormant" || row.verdict === "touched" ? "bg-(--tmd-warning)/10 text-(--tmd-warning)"
                        : "bg-(--tmd-bg-subtle) text-(--tmd-fg-muted)"
                }`}>{t(VERDICT_LABEL[row.verdict])}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10px] text-(--tmd-fg)">{row.text}</span>
                  {row.reason && <span className="mt-0.5 block text-[10px] text-(--tmd-fg-muted)">{row.reason}</span>}
                  <span className="mt-0.5 block truncate font-mono text-[9px] text-(--tmd-fg-faint)">{row.file.split("/").pop()} · L{row.line}{row.aiBad ? ` · ${t("AI 不可识别")}` : ""}</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <p className="text-(--tmd-fg-faint)">{t("本条记录未存行级明细(旧版本记录);重新体检后即可回看每条规则结果。")}</p>
      )}
      <p className="text-(--tmd-fg-faint)">
        {t("扫描记录回答「这次用什么口径、扫到了什么、AI 完成到哪一步」;每次运行新增一条,失败也保留,不覆盖旧记录。")}
      </p>
    </div>
  );
}

/** 扫描记录列表(每次体检一条,点击展开详情)。 */
export function ScanHistory({ revision, cwd }: { revision: number; cwd: string | null }) {
  const [data, setData] = useState<LintStoreData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    void loadStore().then(setData);
  }, [revision]);
  const rows = (data?.scanHistory ?? []).filter((r) => (cwd ? r.cwd === cwd : true));
  return (
    <div>
      <div className={HEAD_CLS}>{t("扫描记录")}({rows.length})</div>
      {rows.map((r) => {
        const id = `${r.at}:${r.engineId}:${r.rules}`;
        const open = openId === id;
        return (
          <div key={id} className="px-3 py-1">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : id)}
              className={`flex w-full items-center gap-3 text-left text-meta text-(--tmd-fg-muted) hover:text-(--tmd-accent) ${open ? "text-(--tmd-accent)" : ""}`}
            >
              <span className="flex-none font-mono">{day(r.at)}</span>
              <span className="flex-none">{r.cwd.split("/").pop()}</span>
              <span className="min-w-0 flex-1 truncate">
                {t("{f} 文件 · {r} 规则 · 判定 {j}/{n} · 发现 {d}", {
                  f: String(r.files), r: String(r.rules), j: String(r.judged), n: String(r.rules), d: String(r.findings),
                })}
              </span>
              <span className="ml-auto flex-none truncate font-mono text-(--tmd-fg-faint)">
                {r.engineError || `${r.engineId}${r.model ? `:${r.model}` : ""}`}
              </span>
              <span className={`flex-none text-(--tmd-fg-faint) transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
            </button>
            {open && <ScanDetail r={r} />}
          </div>
        );
      })}
      {rows.length === 0 && <div className="px-3 py-2 text-meta text-(--tmd-fg-faint)">{t("还没有扫描记录")}</div>}
    </div>
  );
}

/** 应用记录展开详情补充:写回安全与撤销语义(设计说明)。 */
function ApplySafetyNote() {
  return (
    <div className="mt-1 space-y-1 border-l-2 border-(--tmd-border) px-3 text-meta leading-relaxed">
      <p className="text-(--tmd-fg-muted)">
        {t("写回安全:保存前自动备份 .bak-tmdlint,写前重读原文逐行守卫;本条记录完整保留保存前后内容。")}
      </p>
      <p className="text-(--tmd-fg-faint)">
        {t("撤销 = 把保存前内容写回文件并新增一条撤销记录;历史不删除,可继续回看。")}
      </p>
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
            {open && (
              <>
                <DiffPreview lines={diffLines(r.before, r.after)} />
                <ApplySafetyNote />
              </>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <div className="px-3 py-2 text-meta text-(--tmd-fg-faint)">{t("还没有应用记录;每次体检后的修改都会记在这里")}</div>}
    </div>
  );
}
