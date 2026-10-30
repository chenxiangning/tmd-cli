/**
 * 会话输出日志清理(白名单动作 c):崩溃/强退残留的死日志按 mtime TTL
 * 清理。两档:按设置保留策略 / 全清;活会话 Rust 侧永不删。两步武装
 * 确认(3s 回弹)与 checkpoints 段同款纪律。
 */

import { useEffect, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { useSettingsState } from "@kernel/settings";
import { formatBytes } from "./format";

const ARM_MS = 3000;

type Report = { removedFiles: number; removedBytes: number; removedDirs: number } | null;

export function SessionLogCleanup() {
  const { settings } = useSettingsState();
  const [armed, setArmed] = useState<"policy" | "all" | null>(null);
  const [busy, setBusy] = useState<"policy" | "all" | null>(null);
  const [result, setResult] = useState<Report>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  async function run(mode: "policy" | "all") {
    setArmed(null);
    setBusy(mode);
    setError(null);
    try {
      setResult(await ipc.sessionLogCleanup(mode === "all" ? 0 : settings.sessionLogRetentionDays));
    } catch (e) {
      setError(errTextDisplay(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-5">
      <h3 className="mb-1 font-semibold">{t("会话输出日志")}</h3>
      <p className="mb-2 text-(--tmd-fg-muted)">
        {t(
          "应用异常退出会残留会话输出日志;按设置的保留策略清理,或全清历史日志。使用中的会话不受影响,不可恢复。",
        )}
      </p>
      {error && <p className="mb-2 text-(--tmd-diff-deleted)">{t("操作失败:{error}", { error })}</p>}
      {result && (
        <p className="mb-2 text-(--tmd-diff-inserted)">
          {t("已回收 {size}({n} 个文件)", {
            size: formatBytes(result.removedBytes),
            n: result.removedFiles,
          })}
        </p>
      )}
      <div className="flex items-center gap-1">
        {(["policy", "all"] as const).map((mode) =>
          armed === mode ? (
            <span key={mode} className="flex gap-1">
              <button
                type="button"
                disabled={busy !== null}
                className="h-6 rounded border border-(--tmd-diff-deleted)/50 px-2 text-(--tmd-diff-deleted) hover:bg-(--tmd-diff-deleted)/10 disabled:opacity-40"
                onClick={() => void run(mode)}
              >
                {busy === mode ? t("清理中…") : t("确认清理")}
              </button>
              <button
                type="button"
                className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
                onClick={() => setArmed(null)}
              >
                {t("取消")}
              </button>
            </span>
          ) : (
            <button
              key={mode}
              type="button"
              disabled={busy !== null}
              title={
                mode === "policy"
                  ? t("清掉超过保留天数的历史日志(保留策略见设置-行为)")
                  : t("清掉全部历史日志,仅保留使用中会话")
              }
              className="flex h-6 shrink-0 items-center gap-1 rounded border border-(--tmd-border) px-2 hover:bg-(--tmd-bg-hover) disabled:opacity-40"
              onClick={() => setArmed(mode)}
            >
              <Trash size="0.75rem" aria-hidden />
              {mode === "policy" ? t("按保留策略清理") : t("清空全部")}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
