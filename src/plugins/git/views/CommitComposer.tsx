/**
 * CommitComposer —— 自 DiffView.tsx 拆出(文件规模铁则)。
 * 提交 composer(prompt 式,常驻底部;单行起步随内容长高,保留多行提交信息;
 * ⌘⏎ 提交;--amend 开关;提交范围 = 已暂存 ∪ 勾选,按路径集合并防双计)。
 */

import { useEffect, useMemo, useReducer, useRef } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";

interface ComposerState {
  message: string;
  amend: boolean;
  busy: boolean;
  error: string | null;
  /** 提交成功的用户可见反馈(与 error 同槽位家族;下一次编辑/提交即清)。 */
  note: string | null;
}

type ComposerAction =
  | { type: "edit"; message: string }
  | { type: "toggleAmend" }
  | { type: "prefill"; message: string }
  | { type: "submitStart" }
  | { type: "submitOk"; note: string }
  | { type: "submitFail"; error: string };

const INITIAL_STATE: ComposerState = {
  message: "",
  amend: false,
  busy: false,
  error: null,
  note: null,
};

function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "edit":
      return { ...state, message: action.message, note: null };
    case "toggleAmend":
      return { ...state, amend: !state.amend };
    case "prefill":
      return { ...state, message: action.message };
    case "submitStart":
      return { ...state, busy: true, error: null, note: null };
    case "submitOk":
      return { ...INITIAL_STATE, note: action.note };
    case "submitFail":
      return { ...state, busy: false, error: action.error };
  }
}

/** 自适应高度:单行起步随内容长高,160px 封顶。 */
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export function CommitComposer({
  cwd,
  checked,
  stagedPaths,
  prefill,
  onCommitted,
}: {
  cwd: string;
  checked: ReadonlySet<string>;
  stagedPaths: string[];
  prefill: { message: string; seq: number } | null;
  onCommitted: () => void;
}) {
  const [state, dispatch] = useReducer(composerReducer, INITIAL_STATE);
  const { message, amend, busy, error, note } = state;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* 高度重量:输入时在 onChange 直接量(e.target 已是新值);预填/提交清空
     改的是 state,DOM 下一帧才新值,走 rAF 量 —— 不挂 message 依赖 effect,
     避免「prefill effect → setState → 量高效应」的链式触发。 */
  const scheduleAutosize = () => {
    requestAnimationFrame(() => {
      if (inputRef.current) autosize(inputRef.current);
    });
  };

  useEffect(() => {
    if (!prefill) return;
    dispatch({ type: "prefill", message: prefill.message });
    scheduleAutosize();
  }, [prefill]);

  /* 提交范围 = 已暂存 ∪ 勾选(复合文件两段各一行,按路径集合并防双计)。
   * 已暂存内容本就随 git commit 落库,staged ∪ checked 如实呈现提交面。 */
  const selected = useMemo(() => {
    const s = new Set(checked);
    for (const p of stagedPaths) s.add(p);
    return s.size;
  }, [checked, stagedPaths]);

  const canCommit = message.trim().length > 0 && (selected > 0 || amend);

  const submit = () => {
    if (!canCommit || busy) return;
    dispatch({ type: "submitStart" });
    ipc.gitCommit(cwd, [...checked], { message, amend }).then(
      (sha) => {
        dispatch({ type: "submitOk", note: t("已提交 {sha}", { sha: sha.slice(0, 7) }) });
        scheduleAutosize();
        onCommitted();
      },
      (e: unknown) => {
        dispatch({ type: "submitFail", error: gitErrorDisplay(e) });
      },
    );
  };

  return (
    <div className="shrink-0 border-t border-(--tmd-border) p-2 font-mono text-xs">
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 pt-0.5 text-(--tmd-fg-muted)">commit ▸</span>
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => {
            dispatch({ type: "edit", message: e.target.value });
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("提交信息…")}
          rows={1}
          className="w-full resize-none border-0 border-b border-(--tmd-border) bg-transparent px-0.5 py-0.5 outline-none focus:border-(--tmd-border-strong) placeholder:text-(--tmd-fg-faint)"
        />
      </div>
      {error && (
        <div className="mt-1 bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      {note && (
        <div className="mt-1 bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-inserted)">
          {note}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2.5 text-[0.6875rem] text-(--tmd-fg-faint)">
        <button
          type="button"
          title={t("附加 --amend:改动并入上一个提交")}
          onClick={() => dispatch({ type: "toggleAmend" })}
          className="cursor-pointer select-none hover:text-(--tmd-fg-muted)"
        >
          <span className={amend ? "text-(--tmd-fg)" : ""}>{amend ? "[x]" : "[ ]"}</span> --amend
        </button>
        <span>{selected} selected</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={submit}
          disabled={!canCommit || busy}
          title={t("提交(⌘⏎)")}
          className="flex items-center gap-1 bg-(--tmd-accent) px-3 py-0.5 text-(--tmd-accent-fg) disabled:cursor-default disabled:bg-(--tmd-bg-sunken) disabled:text-(--tmd-fg-faint)"
        >
          {busy && <CircleNotch className="h-[0.75rem] w-[0.75rem] animate-spin" />}
          ⌘⏎ commit
        </button>
      </div>
    </div>
  );
}
