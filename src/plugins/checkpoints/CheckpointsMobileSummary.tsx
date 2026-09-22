/**
 * 审批线窄屏只读摘要 —— 手机上审批线面板(右栏 filePanel)不挂载,经 overlay
 * 挂点在窄屏提供批次清单只读视图(spec 终态清单 3「审批线摘要只读可见」)。
 * 数据源 = checkpoints store(与桌面面板同一 hook 链;checkpoint_list 已过
 * AppDevice 只读白名单)。写操作(应用/回退/批准)一律不出现 —— 移动设备域
 * 拒,UI 亦不提供入口。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import { useIsNarrow } from "@kernel/uiBreakpoint";
import { host, useHost } from "@kernel/host";
import type { CkptBatch } from "@kernel/ipc";
import { useCkptAutoRefresh, useCkptScope } from "./useCkptScope";
import { useCkptBatches } from "./store";

function relTime(ts: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (d < 60) return t("刚刚");
  if (d < 3600) return t("{n} 分钟前", { n: Math.floor(d / 60) });
  if (d < 86400) return t("{n} 小时前", { n: Math.floor(d / 3600) });
  return t("{n} 天前", { n: Math.floor(d / 86400) });
}

const STATE_LABEL: Record<CkptBatch["state"], string> = {
  pending: "待审",
  approved: "已通过",
  reverted: "已回退",
  done: "已处理",
};

export function CheckpointsMobileSummary() {
  const narrow = useIsNarrow();
  const [open, setOpen] = useState(false);
  useHost();
  const activeId = host.getActiveSessionId();
  const meta = activeId ? host.getSessions().find((s) => s.id === activeId) : undefined;
  /* 与桌面面板同一 scope/刷新链(非窄屏也照常订阅,组件本体 early-return)。 */
  const { cwd, sessionId, tmdSessionId } = useCkptScope();
  useCkptAutoRefresh(cwd, sessionId, tmdSessionId);
  const state = useCkptBatches(cwd, sessionId);
  if (!narrow) return null;
  const sealed = state.batches.filter((b) => !b.open);
  const pending = sealed.filter((b) => b.state === "pending").length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-4 z-40 flex h-11 items-center gap-2 rounded-full bg-(--tmd-bg-elevated) px-4 text-[0.875rem] text-(--tmd-fg) shadow-lg ring-1 ring-(--tmd-border)"
      >
        {t("审批线")}
        {pending > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff9f0a] px-1 text-[0.75rem] font-semibold text-black">
            {pending}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end">
          <button
            type="button"
            aria-label={t("关闭")}
            className="absolute inset-0 cursor-default bg-black/45"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 max-h-[60vh] w-full overflow-auto rounded-t-2xl border-t border-(--tmd-border) bg-(--tmd-bg-base) p-4 pb-6">
            <div className="mb-1 text-[0.9375rem] font-semibold">
              {t("审批线 · {session}", { session: meta?.title || meta?.id || "" })}
            </div>
            <div className="mb-3 text-[0.75rem] text-(--tmd-fg-dim)">{t("只读摘要 · 处理请在桌面端进行")}</div>
            {state.error && (
              <div className="mb-3 rounded-lg bg-[#ff453a]/10 px-3 py-2 text-[0.75rem] text-[#ff453a]">
                {t("清单刷新失败:{error}", { error: state.error.replace(/^E_\w+:\s*/, "") })}
              </div>
            )}
            {sealed.length === 0 && !state.error && (
              <div className="py-6 text-center text-[0.8125rem] text-(--tmd-fg-dim)">{t("暂无批次")}</div>
            )}
            {sealed
              .slice()
              .reverse()
              .map((b) => (
                <div key={b.id} className="mb-2 rounded-xl bg-(--tmd-bg-muted) px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[0.8125rem]">
                    <span className="shrink-0 font-mono text-(--tmd-fg-dim)">#{b.index}</span>
                    <span className="min-w-0 flex-1 truncate">{b.prompt || t("(无提示词)")}</span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] ${b.state === "pending" ? "bg-[#ff9f0a]/20 text-[#ff9f0a]" : "text-(--tmd-fg-dim)"}`}
                    >
                      {t(STATE_LABEL[b.state])}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-3 text-[0.6875rem] text-(--tmd-fg-dim)">
                    <span>{relTime(b.ts)}</span>
                    <span>{t("{n} 个文件", { n: b.files.length })}</span>
                    {b.engine && <span>{b.engine}</span>}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
