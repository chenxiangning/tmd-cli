/**
 * 体检运行态 · 判定会话实时 PTY 幕布(右栏)。
 * 数据源 = runJudgeRaw 的 pty://out 尾窗(progress.live,清洗文本尾部 4KB);
 * 幕布只做原样上屏 + 自动滚底,不渲染气泡/Markdown(PTY 幕布硬约束)。
 */

import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { LintProgress } from "./lintModel";

/** 进度步进文案(幕布头部相位,纯函数,组件内使用)。 */
function curtainPhase(p: LintProgress): string {
  if (p.step === "recognize") return t("AI 识别中(全文比对)…{f}", { f: p.detail });
  if (p.step === "judge") return t("AI 判定中 {d}/{t}", { d: String(p.done ?? 0), t: String(p.total ?? 0) });
  if (p.step === "corpus") return p.detail ? t("读对话中…({p})", { p: p.detail }) : t("读对话中…");
  if (p.step === "evidence") return t("抽证据中…({n} 条消息)", { n: p.detail });
  if (p.step === "targets") return t("读规则中…");
  return t("体检完成");
}

export function PtyCurtain({ progress, title }: { progress: LintProgress; title: string }) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const live = progress.live ?? "";
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live]);
  return (
    <div className="mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2c332f] bg-[#0f1513]">
      <div className="flex flex-none items-center gap-1.5 border-b border-[#2c332f] px-2.5 py-1.5 text-[10px] text-[#8d9b94]">
        <span className="size-1.5 animate-pulse rounded-full bg-[#e6a76c]" aria-hidden />
        <span className="min-w-0 truncate font-mono">{title}</span>
        <span className="ml-auto flex-none">{curtainPhase(progress)}</span>
      </div>
      <pre
        ref={bodyRef}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[10px] leading-[1.75] text-[#cfd8d3]"
      >
        {live || t("等待判定会话输出…")}
      </pre>
    </div>
  );
}
