/**
 * RpcTimeline —— RPC 会话(带渲染的会话)的右栏时间线简化形态。
 * 数据直读 kernel 行投影的 userTexts(structured-session 广播,不经 PTY
 * 锚点轮询——RPC 无幕布 buffer);序号倒序(最新在顶)与 PTY 时间线同构;
 * hover「复制」与回显同 TimelineRow 口径(copyText 唯一原语);
 * 不渲染「定位幕布」(RPC 无幕布可定位)与轮文件 chip(批次归因未经实测,
 * 不猜测)。「进行中」标最新一条(busy 时,行投影同源)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ClockClockwise } from "@phosphor-icons/react";
import { Empty } from "@kernel/Empty";
import { copyText } from "@kernel/clipboard";
import { t } from "@kernel/i18n";
import { useStructuredSessionRows } from "@kernel/structuredSessionTabs";
import { PromptImages } from "./PromptImages";
import { AttachmentFiles, RowRail } from "./TimelineRowParts";
import { extractTimelineParts } from "./timelineText";

/** 文本超过该长度才出「展开全文」(与 TimelineRow 同口径)。 */
const CLAMP_MIN_CHARS = 120;
/** 复制成功的「已复制」回显时长(与 TimelineRow 同口径)。 */
const COPIED_FLASH_MS = 1200;

export function RpcTimeline({ tabId }: { tabId: string }) {
  const row = useStructuredSessionRows().find((r) => r.tabId === tabId);
  const texts = row?.userTexts ?? [];
  if (texts.length === 0) {
    return (
      <Empty icon={<ClockClockwise />}>
        {t("本会话还没有用户消息 —— 发送一条后,这里按时间记录")}
      </Empty>
    );
  }
  /* 最新在顶;seq 取正序下标 +1(与 TimelinePanel 同律)。 */
  const items = texts.map((text, i) => ({ text, seq: i + 1 })).reverse();
  const lastSeq = items[0].seq;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-2 pl-1">
      {items.map(({ text, seq }, i) => (
        <RpcRow key={seq} text={text} seq={seq} last={i === items.length - 1} live={row?.busy === true && seq === lastSeq} />
      ))}
    </div>
  );
}

function RpcRow({ text, seq, last, live }: {
  text: string;
  seq: number;
  /** 时间线最旧一条:不再向下画连接线。 */
  last: boolean;
  live: boolean;
}) {
  const parts = useMemo(() => extractTimelineParts(text), [text]);
  const clampable = parts.text.length > CLAMP_MIN_CHARS;
  const [open, setOpen] = useState(false);
  /* 复制回显:行内局部态 + 定时归位;卸载清定时器防悬挂(TimelineRow 同律)。 */
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  function onCopy() {
    void copyText(text)
      .then(() => {
        setCopied(true);
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
      })
      .catch(() => undefined); /* 双路径皆败:静默(与 TimelineRow 同口径) */
  }

  return (
    <div className="group flex gap-2 rounded-(--tmd-radius-sm) px-1.5 py-[7px] transition-colors hover:bg-(--tmd-bg-hover)">
      <RowRail last={last} live={live} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5 text-meta leading-4 text-(--tmd-fg-faint)">
          <span className="font-mono font-semibold text-(--tmd-fg-muted)">#{seq}</span>
          {live && (
            <span className="rounded bg-(--tmd-accent)/15 px-1 text-(--tmd-accent)">
              {t("进行中")}
            </span>
          )}
          {/* RPC 无幕布可定位:不出「定位幕布」钮;附件 token 经 extractTimelineParts 剥离。 */}
          <button
            type="button"
            onClick={onCopy}
            className={`ml-auto rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 text-meta leading-4 text-(--tmd-accent) transition-opacity group-focus-within:opacity-100 ${
              copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {copied ? t("已复制") : t("复制")}
          </button>
        </div>
        {parts.text ? (
          <div
            className={`rounded-r border-l-2 border-(--tmd-accent) bg-(--tmd-bg-hover) px-2.5 py-1.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-(--tmd-fg) ${
              clampable && !open ? "line-clamp-3" : ""
            }`}
          >
            {parts.text}
          </div>
        ) : null}
        {clampable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-meta text-(--tmd-accent)"
          >
            {open ? t("收起") : t("展开全文")}
          </button>
        )}
        <PromptImages images={parts.images} />
        <AttachmentFiles files={parts.files} />
      </div>
    </div>
  );
}
