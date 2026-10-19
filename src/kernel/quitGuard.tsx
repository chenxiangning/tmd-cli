/**
 * 关窗闸聚合弹层(0.4.0 项 12)—— 有脏 tab 时红 X / 系统关窗先弹这里确认。
 * 编排(订阅 onCloseRequested、裁决、强制放行、⌘Q 腿裁决)在 quitGuardBoot.ts,
 * 纯裁决在 quitGuardPlan.ts;本件只留 QuitDialog 组件(Fast Refresh 保态)。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogShell } from "./DialogShell";

/** 聚合弹层的脏 tab 条目(id 供列表 key 稳定;标题 + kind 徽标)。 */
export interface QuitEntry {
  id: string;
  title: string;
  kind: string;
}

export function QuitDialog({
  entries,
  onConfirm,
  onCancel,
}: {
  entries: readonly QuitEntry[];
  onConfirm: (dontAsk: boolean) => void;
  onCancel: () => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  /* 安全默认:danger 弹层聚焦取消钮(ConfirmDialog 同款语义)。 */
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <DialogShell
      title={t("有 {n} 个未保存草稿", { n: entries.length })}
      icon={<span aria-hidden>⚠</span>}
      width={440}
      onClose={onCancel}
      footer={
        <div className="mt-4 flex items-center gap-2">
          <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-(--tmd-fg-muted)">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            {t("本次不再问")}
          </label>
          <button
            type="button"
            ref={cancelRef}
            className="rounded border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
            onClick={onCancel}
          >
            {t("取消")}
          </button>
          <button
            type="button"
            className="rounded bg-(--tmd-err) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90"
            onClick={() => onConfirm(dontAsk)}
          >
            {t("放弃并退出")}
          </button>
        </div>
      }
    >
      <div className="mt-2 flex flex-col gap-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-2 rounded bg-(--tmd-bg-subtle) px-2 py-1 text-xs"
          >
            <span className="truncate">{entry.title}</span>
            <span className="flex-none font-mono text-[10px] text-(--tmd-fg-faint)">{entry.kind}</span>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
