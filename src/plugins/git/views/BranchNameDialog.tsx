/**
 * 分支输入对话框(应用内 modal,复刻 codemoss 新建/重命名对话框字段语义):
 * - 「从 X 新建分支」:源分支只读展示 + 新名输入(默认空,placeholder 引导);
 * - 「重命名」:原名只读展示 + 新名预填全选。
 * portal + fixed z-1000(同 GitConfirmDialog 层级纪律);Esc/遮罩 = 取消;
 * Enter = 确认(输入框 autoFocus);空名/与原名同名禁用确认。
 */
import { t } from "@kernel/i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface BranchNameDialogState {
  title: string;
  /** 只读展示的关联分支(新建的起点 / 重命名前的原名) */
  source: string;
  sourceLabel: string;
  inputLabel: string;
  /** 预填(重命名 = 原名;新建 = 空) */
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}

export function BranchNameDialog({
  state,
  onClose,
}: {
  state: BranchNameDialogState;
  onClose: () => void;
}) {
  const [name, setName] = useState(state.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = name.trim();
  const canConfirm = trimmed.length > 0 && trimmed !== state.initial;

  const submit = () => {
    if (!canConfirm) return;
    onClose();
    state.onSubmit(trimmed);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") submit();
        }}
      >
        <div className="text-xs font-medium text-(--tmd-fg)">{state.title}</div>
        <div className="mt-2 text-[11px] text-(--tmd-fg-muted)">
          {state.sourceLabel}
          <span className="ml-1 font-medium text-(--tmd-fg)">{state.source}</span>
        </div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={state.placeholder}
          spellCheck={false}
          className="mt-2 w-full rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
        />
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            onClick={onClose}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            disabled={!canConfirm}
            onClick={submit}
            className="rounded bg-(--tmd-accent) px-2.5 py-1 text-xs text-(--tmd-accent-fg) disabled:opacity-40"
          >
            {state.submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
