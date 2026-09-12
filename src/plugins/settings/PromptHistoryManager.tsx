/**
 * 输入历史管理区(设置 / 行为)—— 折叠列表:使用次数徽标 + 逐条删除 +
 * 清空全部(两步 armed 确认,循 SessionContextMenu 先例,无新弹窗组件)。
 * 数据经 subscribePromptHistory 实时跟踪:每次 composer 提交都会入史。
 * 参考 codemoss PromptHistorySettings,控件按 tmd-cli pref 词汇重写。
 */

import { useEffect, useState } from "react";
import { CaretDown, CaretRight, Trash, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import {
  clearPromptHistory,
  deletePrompt,
  getPromptHistoryWithCounts,
  subscribePromptHistory,
} from "@kernel/promptHistory";

export function PromptHistoryManager() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(getPromptHistoryWithCounts);
  const [armed, setArmed] = useState(false);

  useEffect(
    () => subscribePromptHistory(() => setEntries(getPromptHistoryWithCounts())),
    [],
  );

  return (
    <div className="pref-card" data-testid="settings-prompt-history">
      <div className={`flex min-h-[52px] items-center justify-between gap-4 py-2.5 pl-4 pr-2.5 ${open && entries.length > 0 ? "border-b border-(--tmd-border)" : ""}`}>
        {/* 折叠开关独占一个 button:清空全部保持兄弟控件(不嵌套,react-doctor 治理) */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          {open
            ? <CaretDown size="0.875rem" className="shrink-0 text-(--tmd-fg-muted)" aria-hidden />
            : <CaretRight size="0.875rem" className="shrink-0 text-(--tmd-fg-muted)" aria-hidden />}
          <span className="font-semibold">{t("管理历史记录")} ({entries.length})</span>
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            title={t("清空全部输入历史")}
            onClick={(e) => {
              e.stopPropagation();
              if (!armed) { setArmed(true); return; }
              clearPromptHistory();
              setArmed(false);
            }}
            onBlur={() => setArmed(false)}
            className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] transition-colors ${
              armed ? "bg-red-400/15 text-red-400" : "text-red-400 hover:bg-(--tmd-bg-hover)"
            }`}
          >
            <Trash size="0.875rem" aria-hidden />
            {armed ? t("确认清空?") : t("清空全部")}
          </button>
        )}
      </div>
      {open && entries.length === 0 && (
        <p className="py-2.5 pr-2.5 pl-8 text-[0.8125rem] text-(--tmd-fg-muted)">{t("暂无历史记录")}</p>
      )}
      {open && entries.length > 0 && (
        <div className="max-h-72 overflow-y-auto">
          {entries.map((entry) => (
            <div
              key={entry.text}
              className="flex items-center gap-2 border-t border-(--tmd-border) py-2 pr-2.5 pl-4 first:border-t-0"
            >
              <span className="shrink-0 rounded-sm bg-(--tmd-bg-hover) px-1.5 py-0.5 font-mono text-[0.6875rem] text-(--tmd-fg-muted)">
                [{entry.count}]
              </span>
              <span title={entry.text} className="min-w-0 flex-1 truncate text-sm">{entry.text}</span>
              <button
                type="button"
                aria-label={t("删除此条历史记录")}
                title={t("删除此条历史记录")}
                onClick={() => deletePrompt(entry.text)}
                className="shrink-0 cursor-pointer rounded-md p-1 text-(--tmd-fg-muted) transition-colors hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
              >
                <X size="0.875rem" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
