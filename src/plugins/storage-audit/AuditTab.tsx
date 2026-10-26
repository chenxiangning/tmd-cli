/**
 * 体检面 —— 「开始体检」才扫(结果不自动刷新);分桶表格:类目/体积/文件数。
 * 超时与未使用是两态:timedOut 标「超时」(占用未知),全零标「未使用」。
 * CLI 会话目录行只读,带「零触碰」红线标注;清理入口只在清理面。
 */

import { useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { CircleNotch, MagnifyingGlass } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { auditCategories, reportByKey, type AuditCategory } from "./auditCategories";
import { formatBytes } from "./format";

type Phase = "idle" | "running" | "done";
type Report = { bytes: number; files: number; timedOut: boolean };

/** 可清类目的说明(其余 CLI 类目统一零触碰文案);静态小表用 Record。 */
const CAT_CLEANABLE_NOTE: Record<string, string> = {
  checkpoints: "恢复点数据,可按工作区清理(见下方清理)",
  docgen: "工作台生成文档,可清已归档版本(见下方清理)",
  "session-logs": "会话输出日志,可按保留策略清理(见下方清理)",
};

export function AuditTab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cats, setCats] = useState<AuditCategory[]>([]);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    setError(null);
    try {
      const [home, configDir] = await Promise.all([ipc.configHomeDir(), ipc.configDir()]);
      const categories = auditCategories(home, configDir);
      const rs = await ipc.fsDirUsage(
        categories.map((c) => ({ label: c.key, path: c.path, skipDirNames: c.skipDirNames })),
      );
      setCats(categories);
      setReports(reportByKey(rs));
    } catch (e) {
      setError(errTextDisplay(e));
    } finally {
      setPhase("done");
    }
  }

  /* 展示序:已知体积降序(大占用在前),未使用/超时沉底。 */
  const scoreOf = (key: string) => {
    const r = reports[key];
    return r && !r.timedOut ? r.bytes : -1;
  };
  const sorted = [...cats].sort((a, b) => scoreOf(b.key) - scoreOf(a.key));
  const maxBytes = Math.max(0, ...sorted.map((c) => scoreOf(c.key)));
  const known = sorted.map((c) => reports[c.key]).filter((r) => r && !r.timedOut);
  const totalBytes = known.reduce((s, r) => s + r!.bytes, 0);
  const totalFiles = known.reduce((s, r) => s + r!.files, 0);
  const anyTimedOut = sorted.some((c) => reports[c.key]?.timedOut);

  return (
    <div className="text-xs">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          disabled={phase === "running"}
          className="flex h-7 items-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) px-2.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
          onClick={() => void run()}
        >
          {phase === "running" ? (
            <CircleNotch size="0.875rem" className="animate-spin" aria-hidden />
          ) : (
            <MagnifyingGlass size="0.875rem" aria-hidden />
          )}
          {phase === "running" ? t("体检中…") : phase === "done" ? t("重新体检") : t("开始体检")}
        </button>
        <span className="text-(--tmd-fg-muted)">{t("扫描全部分桶,单类目 20s 超时保护。")}</span>
      </div>

      {error && (
        <p className="mb-2 text-(--tmd-diff-deleted)">
          {t("体检失败:{error}", { error })}
        </p>
      )}

      {phase === "done" && cats.length > 0 && (
        <div className="overflow-hidden rounded-(--tmd-radius-sm) border border-(--tmd-border)">
          <div className="grid grid-cols-[minmax(8rem,1fr)_7rem_5rem] gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-hover)/50 px-2.5 py-1.5 font-semibold">
            <span>{t("类目")}</span>
            <span className="text-right">{t("体积")}</span>
            <span className="text-right">{t("文件数")}</span>
          </div>
          {sorted.map((c) => {
            const r = reports[c.key];
            const cleanable = c.key in CAT_CLEANABLE_NOTE;
            const barPct = r && !r.timedOut && maxBytes > 0 ? Math.sqrt(r.bytes / maxBytes) * 100 : 0;
            return (
              <div
                key={c.key}
                className="grid grid-cols-[minmax(8rem,1fr)_7rem_5rem] items-baseline gap-2 border-b border-(--tmd-border) px-2.5 py-1.5 last:border-b-0 hover:bg-(--tmd-bg-hover)/40"
              >
                <span className="min-w-0">
                  <span className="font-mono">{c.key}</span>
                  <span className={`ml-1.5 ${cleanable ? "text-(--tmd-diff-inserted)" : "text-(--tmd-fg-muted)"}`}>
                    {cleanable
                      ? t(CAT_CLEANABLE_NOTE[c.key])
                      : t("CLI 会话目录,只读零触碰")}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  {r && !r.timedOut && r.bytes > 0 && (
                    <span className="h-1 w-full overflow-hidden rounded-full bg-(--tmd-bg-hover)">
                      <span
                        className="block h-full rounded-full bg-(--tmd-fg-muted)"
                        style={{ width: `${barPct}%` }}
                      />
                    </span>
                  )}
                  <span className="tabular-nums">
                    {!r
                      ? "—"
                      : r.timedOut
                        ? t("超时")
                        : r.bytes === 0 && r.files === 0
                          ? t("未使用")
                          : formatBytes(r.bytes)}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  {!r || r.timedOut ? "—" : r.files}
                </span>
              </div>
            );
          })}
          <div className="grid grid-cols-[minmax(8rem,1fr)_7rem_5rem] items-baseline gap-2 bg-(--tmd-bg-hover)/50 px-2.5 py-1.5 font-semibold">
            <span>{t("合计")}</span>
            <span className="flex flex-col items-end gap-0.5">
              <span className="tabular-nums">{formatBytes(totalBytes)}</span>
              {anyTimedOut && (
                <span className="text-[0.625rem] font-normal text-(--tmd-fg-muted)">
                  {t("部分类目超时,体积合计不含")}
                </span>
              )}
            </span>
            <span className="text-right tabular-nums">{totalFiles}</span>
          </div>
        </div>
      )}
    </div>
  );
}
