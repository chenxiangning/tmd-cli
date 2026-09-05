/**
 * CommitComposer —— 自 DiffView.tsx 拆出(文件规模铁则)。
 * 提交 composer(prompt 式,常驻底部;单行起步随内容长高,保留多行提交信息;
 * ⌘⏎ 提交;--amend 开关;提交范围 = 已暂存 ∪ 勾选,按路径集合并防双计)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ipc } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";

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
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill) setMessage(prefill.message);
  }, [prefill]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message]);

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
    setBusy(true);
    setError(null);
    ipc.gitCommit(cwd, [...checked], { message, amend }).then(
      (sha) => {
        setMessage("");
        setAmend(false);
        setBusy(false);
        setError(null);
        console.info(`已提交 ${sha.slice(0, 7)}`);
        onCommitted();
      },
      (e: unknown) => {
        setBusy(false);
        setError(gitErrorDisplay(e));
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
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="提交信息…"
          rows={1}
          className="w-full resize-none border-0 border-b border-(--tmd-border) bg-transparent px-0.5 py-0.5 outline-none focus:border-(--tmd-border-strong) placeholder:text-(--tmd-fg-faint)"
        />
      </div>
      {error && (
        <div className="mt-1 bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-(--tmd-fg-faint)">
        <button
          type="button"
          title="附加 --amend:改动并入上一个提交"
          onClick={() => setAmend((v) => !v)}
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
          title="提交(⌘⏎)"
          className="flex items-center gap-1 bg-(--tmd-accent) px-3 py-0.5 text-(--tmd-accent-fg) disabled:cursor-default disabled:bg-(--tmd-bg-sunken) disabled:text-(--tmd-fg-faint)"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          ⌘⏎ commit
        </button>
      </div>
    </div>
  );
}
