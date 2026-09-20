/**
 * 增强右栏面板 —— 状态标签 + 结果体(运行中 = 实时信息流自动滚底;缓存 = 命中徽标;
 * 完成 = 哨兵终稿;失败红字)。从主件拆出(文件规模铁则);状态/内容/样式三分支
 * 收敛为模块级纯函数(降组件控制流复杂度)。
 */

import { useEffect, useRef } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { EnhanceOutcome } from "./enhanceEngines";

type Fail = Extract<EnhanceOutcome, { ok: false }>;

function failCopy(fail: Fail, timeoutSeconds: number): string {
  switch (fail.kind) {
    case "timeout":
      return t("增强超时({seconds} 秒),可重试或调大超时", { seconds: timeoutSeconds });
    case "empty":
      return t("引擎返回空结果,请重试");
    case "engine":
      return `${t("增强失败")}${fail.detail ? `: ${fail.detail}` : ""}`;
  }
}

function paneStatus(running: boolean, fail: Fail | null, enhanced: string, fromCache: boolean): string {
  if (running) return t("增强中…");
  if (fail) return t("增强失败");
  if (!enhanced) return t("等待增强");
  return fromCache ? t("缓存") : "";
}

function paneBody(running: boolean, live: string, fail: Fail | null, enhanced: string, timeoutSeconds: number): string {
  if (running) return live;
  if (fail) return failCopy(fail, timeoutSeconds);
  return enhanced;
}

function paneClass(running: boolean, fail: Fail | null): string {
  if (running) return "border-(--tmd-accent) bg-(--tmd-bg-elevated) font-mono text-(--tmd-fg-muted)";
  if (fail) return "border-(--tmd-border) text-[#f85149]";
  return "border-(--tmd-accent) bg-(--tmd-bg-elevated) text-(--tmd-fg)";
}

export function EnhancedPane({
  running,
  live,
  fail,
  enhanced,
  fromCache,
  timeoutSeconds,
}: {
  running: boolean;
  live: string;
  fail: Fail | null;
  enhanced: string;
  fromCache: boolean;
  timeoutSeconds: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (running && taRef.current) taRef.current.scrollTop = taRef.current.scrollHeight;
  }, [live, running]);
  const showBadge = !running && !fail && fromCache && Boolean(enhanced);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
        <SparkleIcon size="0.75rem" className="text-(--tmd-accent)" />
        {t("增强后的提示词")}
        <span className="ml-auto">{paneStatus(running, fail, enhanced, fromCache)}</span>
        {showBadge && (
          <span className="rounded-sm bg-(--tmd-accent-soft) px-1 text-[0.625rem] text-(--tmd-accent)">{t("缓存")}</span>
        )}
      </div>
      <textarea
        ref={taRef}
        readOnly
        aria-label={t("增强后的提示词")}
        value={paneBody(running, live, fail, enhanced, timeoutSeconds)}
        className={`mt-1.5 h-64 w-full resize-y rounded border p-2 text-xs leading-normal outline-none ${paneClass(running, fail)}`}
      />
    </div>
  );
}
