/**
 * 窄屏审批浮标 —— 手机上的「有会话在等确认」提醒与直达。
 * 数据源 = kernel askWatch(host.isWaitingConfirm,远程态 pty://out 同样驱动);
 * 应答本身在实况幕布用软键盘完成(各 CLI 键位/语义不同,卡片不自造通用 y/n ——
 * 发错键 = 批错操作)。浮标 = 等待会话数,点开 = 列表,点条目 = 切到该会话幕布。
 * 边沿通知:进入等待 → shellBridge 本地通知(壳态);浏览器/桌面态静默。
 */
import { useEffect, useRef, useState } from "react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { hasShellBridge, shellNotify } from "@kernel/shellBridge";
import { useIsNarrow } from "@kernel/uiBreakpoint";

export function AskNotifier() {
  /* 等待边沿 → 本地通知;常驻挂载(桌面态 hasShellBridge=false 即 no-op)。 */
  const wasWaiting = useRef<Set<string>>(new Set());
  const version = useHost();
  useEffect(() => {
    const now = new Set(
      host
        .getSessions()
        .filter((s) => host.isWaitingConfirm(s.id))
        .map((s) => s.id),
    );
    if (!hasShellBridge()) {
      wasWaiting.current = now;
      return;
    }
    for (const id of now) {
      if (!wasWaiting.current.has(id)) {
        const meta = host.getSessions().find((s) => s.id === id);
        void shellNotify(t("等待确认"), meta?.title ?? id).catch(() => undefined);
      }
    }
    wasWaiting.current = now;
  }, [version]);
  return null;
}

export function AskFloatingBadge() {
  const narrow = useIsNarrow();
  const version = useHost();
  const [open, setOpen] = useState(false);
  if (!narrow) return null;
  void version;
  const waiting = host.getSessions().filter((s) => host.isWaitingConfirm(s.id));
  if (waiting.length === 0 && !open) return null;
  return (
    <>
      {waiting.length > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex h-11 items-center gap-2 rounded-full bg-[#ff9f0a] px-4 text-[0.875rem] font-semibold text-black shadow-lg"
        >
          {t("等待确认")}
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/15 text-[0.75rem]">
            {waiting.length}
          </span>
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end">
          <button
            type="button"
            aria-label={t("关闭")}
            className="absolute inset-0 cursor-default bg-black/45"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 max-h-[55vh] w-full overflow-auto rounded-t-2xl border-t border-(--tmd-border) bg-(--tmd-bg-base) p-4 pb-6">
            <div className="mb-3 text-[0.9375rem] font-semibold">{t("等待确认的会话")}</div>
            {waiting.map((s) => (
              <button
                key={s.id}
                type="button"
                className="mb-2 flex w-full items-center gap-2 rounded-xl bg-(--tmd-bg-muted) px-3 py-3 text-left text-[0.875rem]"
                onClick={() => {
                  host.setActiveSession(s.id);
                  setOpen(false);
                }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff9f0a]" />
                <span className="min-w-0 flex-1 truncate">{s.title || s.id}</span>
                <span className="shrink-0 text-(--tmd-fg-dim)">{t("去应答 ›")}</span>
              </button>
            ))}
            <div className="mt-1 text-[0.75rem] text-(--tmd-fg-dim)">
              {t("允许/拒绝请在实况幕布中按键应答(与桌面同一 RPC)")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
