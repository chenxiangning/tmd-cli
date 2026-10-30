/**
 * 体检运行态 · 判定会话实时幕布(右栏)。
 * 上层 = 脚本侧事件流(controller logLine:spawn/提取/证据/批返回,必实时);
 * 底层 = 引擎 PTY 原始输出尾窗(progress.live,omp 等缓冲型引擎到批末才吐字,
 * 只作辅助窗)。幕布只上屏不加工,不渲染气泡/Markdown(PTY 幕布硬约束)。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { LintProgress } from "./lintModel";
import type { LintLogEntry } from "./lintController";

/** 进度步进文案(幕布头部相位,纯函数,组件内使用)。 */
function curtainPhase(p: LintProgress): string {
  const wait = p.waitSec && p.waitSec > 3 ? ` · 已等 ${p.waitSec}s` : "";
  if (p.step === "judge") return `${t("AI 判定中 {d}/{t}", { d: String(p.done ?? 0), t: String(p.total ?? 0) })}${wait}`;
  if (p.step === "corpus") return p.detail ? t("读对话中…({p})", { p: p.detail }) : t("读对话中…");
  if (p.step === "evidence") return t("抽证据中…({n} 条消息)", { n: p.detail });
  if (p.step === "targets") return t("读规则中…");
  return t("体检完成");
}

function statusOf(running: boolean, failed: boolean): { label: string; textCls: string; dotCls: string } {
  if (running) return { label: t("运行中"), textCls: "text-(--tmd-accent)", dotCls: "animate-pulse bg-(--tmd-accent)" };
  if (failed) return { label: t("体检失败"), textCls: "text-(--tmd-error)", dotCls: "bg-(--tmd-error)" };
  return { label: t("体检完成"), textCls: "text-(--tmd-ok)", dotCls: "bg-(--tmd-ok)" };
}

function CurtainHeader({ progress, title, running, failed }: { progress: LintProgress; title: string; running: boolean; failed: boolean }) {
  const status = statusOf(running, failed);
  return (
    <div className="flex-none border-b border-(--tmd-border) px-2.5 py-1.5 text-[10px] text-(--tmd-fg-muted)">
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 flex-none rounded-full ${status.dotCls}`} aria-hidden />
        <span className="min-w-0 truncate font-mono" title={title}>{title}</span>
        <span role="status" aria-live="polite" aria-atomic="true" className={`ml-auto flex-none font-medium ${status.textCls}`}>{status.label}</span>
      </div>
      {running && <div className="mt-1 truncate text-(--tmd-fg-faint)">{curtainPhase(progress)}</div>}
    </div>
  );
}

function logClass(text: string): string {
  if (text.startsWith("[error]")) return "text-(--tmd-error)";
  if (text.startsWith("[done]")) return "text-(--tmd-ok)";
  if (text.startsWith("[wait]")) return "text-(--tmd-warn)";
  return "";
}

function tailText(progress: LintProgress): string {
  if (progress.live) return progress.live;
  if ((progress.liveBytes ?? 0) === 0 && (progress.waitSec ?? 0) > 0) return t("引擎尚未输出任何字节——模型思考中;部分引擎把输出缓冲到结束时一次性给出");
  return "…";
}

export function PtyCurtain({
  progress, title, log, running, error,
}: {
  progress: LintProgress;
  title: string;
  log: LintLogEntry[];
  running: boolean;
  error: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const live = progress.live ?? "";
  const failed = !running && error !== "";

  useEffect(() => {
    const el = logRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live]);

  const backToLatest = () => {
    followRef.current = true;
    setShowLatest(false);
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  return (
    <section aria-label={t("体检事件日志")} aria-busy={running} className="mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated)">
      <CurtainHeader progress={progress} title={title} running={running} failed={failed} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          role="log"
          aria-live="off"
          aria-label={t("体检事件日志")}
          onScroll={(e) => {
            const el = e.currentTarget;
            const following = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
            followRef.current = following;
            setShowLatest(!following);
          }}
          className="h-full overflow-y-auto px-2.5 py-2 font-mono text-[10px] leading-[1.8] text-(--tmd-fg)"
        >
          {log.map((e) => (
            <div key={e.id} className={`whitespace-pre-wrap break-words ${logClass(e.text)}`}>{e.text}</div>
          ))}
          {log.length === 0 && <div className="text-(--tmd-fg-faint)">{t("等待判定会话输出…")}</div>}
        </div>
        {showLatest && (
          <button type="button" onClick={backToLatest} className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 text-[10px] text-(--tmd-accent) shadow-sm transition-colors hover:border-(--tmd-accent)">
            <ArrowDownIcon aria-hidden />
            {t("回到最新")}
          </button>
        )}
      </div>
      <div className="flex-none border-t border-(--tmd-border) px-2.5 pt-1 text-[9px] text-(--tmd-fg-faint)">{t("会话输出")}</div>
      <pre
        ref={tailRef}
        className="h-14 flex-none overflow-y-auto bg-(--tmd-bg-subtle) px-2.5 pb-1.5 font-mono text-[9px] leading-snug whitespace-pre-wrap break-all text-(--tmd-fg-muted)"
      >
        {tailText(progress)}
      </pre>
    </section>
  );
}
