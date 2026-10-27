/**
 * 体检运行态 · 判定会话实时幕布(右栏)。
 * 上层 = 脚本侧事件流(controller logLine:spawn/提取/证据/批返回,必实时);
 * 底层 = 引擎 PTY 原始输出尾窗(progress.live,omp 等缓冲型引擎到批末才吐字,
 * 只作辅助窗)。幕布只上屏不加工,不渲染气泡/Markdown(PTY 幕布硬约束)。
 */

import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { LintProgress } from "./lintModel";
import type { LintLogEntry } from "./lintController";

/** 进度步进文案(幕布头部相位,纯函数,组件内使用)。 */
function curtainPhase(p: LintProgress): string {
  const wait = p.waitSec && p.waitSec > 3 ? ` · 已等 ${p.waitSec}s` : "";
  if (p.step === "recognize") return `${t("AI 识别中(全文比对)…{f}", { f: p.detail })}${wait}`;
  if (p.step === "judge") return `${t("AI 判定中 {d}/{t}", { d: String(p.done ?? 0), t: String(p.total ?? 0) })}${wait}`;
  if (p.step === "corpus") return p.detail ? t("读对话中…({p})", { p: p.detail }) : t("读对话中…");
  if (p.step === "evidence") return t("抽证据中…({n} 条消息)", { n: p.detail });
  if (p.step === "targets") return t("读规则中…");
  return t("体检完成");
}

export function PtyCurtain({ progress, title, log }: { progress: LintProgress; title: string; log: LintLogEntry[] }) {
  const logRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLPreElement>(null);
  const live = progress.live ?? "";
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  useEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live]);
  return (
    <div className="mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2c332f] bg-[#0f1513]">
      <div className="flex flex-none items-center gap-1.5 border-b border-[#2c332f] px-2.5 py-1.5 text-[10px] text-[#8d9b94]">
        <span className="size-1.5 animate-pulse rounded-full bg-[#e6a76c]" aria-hidden />
        <span className="min-w-0 truncate font-mono">{title}</span>
        <span className="ml-auto flex-none">{curtainPhase(progress)}</span>
      </div>
      <div ref={logRef} aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 font-mono text-[10px] leading-[1.8] text-[#cfd8d3]">
        {log.map((e) => (
          <div key={e.id} className={e.text.startsWith("[error]") ? "text-[#e08a85]" : e.text.startsWith("[done]") ? "text-[#8fc7a3]" : undefined}>{e.text}</div>
        ))}
        {log.length === 0 && <div className="text-[#7d8a84]">{t("等待判定会话输出…")}</div>}
      </div>
      <div className="flex-none border-t border-[#2c332f] px-2.5 pt-1 text-[9px] text-[#7d8a84]">{t("会话输出")}</div>
      <pre
        ref={tailRef}
        className="h-14 flex-none overflow-y-auto whitespace-pre-wrap break-all px-2.5 pb-1.5 font-mono text-[9px] leading-snug text-[#8d9b94]"
      >
        {live || ((progress.liveBytes ?? 0) === 0 && (progress.waitSec ?? 0) > 0 ? t("引擎尚未输出任何字节——模型思考中;部分引擎把输出缓冲到结束时一次性给出") : "…")}
      </pre>
    </div>
  );
}
