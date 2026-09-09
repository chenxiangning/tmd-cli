/**
 * TimelinePanel —— 右栏「时间线」页签:本会话用户消息的纵向流(最新在顶)。
 *
 * - 数据源 = kernel messageAnchors:各 CLI 插件 readSessionUserMessages 适配器
 *   2s 轮询回补 + 按 id 增量合并(内核不理解私有行型);仅活跃会话、仅在有
 *   订阅者时轮询 —— 本面板挂载即订阅,切回审批线态即停表。
 * - 「定位幕布」= jumpToAnchor 扎点定位(buffer 匹配 + 28% 留头);失败短暂
 *   闪烁(同 AnchorRail 语义)。整行不可点:消息文本要留选中/复制。
 * - 状态芯片只标「进行中」(promptSent → turnSettled 窗口内的最新条目);
 *   更早条目不标「已结算」—— 结算是默认态,逐条标是噪音。
 * - 条目无时间戳:CliUserMessage 契约只有 id + text,全量相对时间要动
 *   10 家 CLI 适配器解析,二期再议(序号 #N 已给先后)。
 * - 与审批线零共享逻辑:仅同面板摘要行并列(用户定向:不动审批线代码)。
 */

import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { FileText } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import {
  KernelTopics,
  type PromptSentEvent,
  type TurnSettledEvent,
} from "@kernel/events";
import { t } from "@kernel/i18n";
import {
  jumpToAnchor,
  messageAnchors,
  type UserMessageAnchor,
} from "@kernel/messageAnchors";
import { PromptImages } from "./PromptImages";
import { extractTimelineParts } from "./timelineText";

/** 文本超过该长度才出「展开全文」(CSS line-clamp-3 收敛);短消息无折叠件。 */
const CLAMP_MIN_CHARS = 120;
/** 跳转失败的红色闪烁时长(同 AnchorRail MISS_FLASH_MS 语义)。 */
const MISS_FLASH_MS = 900;

export function TimelinePanel() {
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => host.events.on(KernelTopics.activeSessionChanged, bumpRender), []);

  const sessionId = host.getActiveSessionId();
  const anchors = useSyncExternalStore(messageAnchors.subscribe, () =>
    messageAnchors.getAnchors(sessionId),
  );

  /* 在途轮追踪:promptSent 置位、turnSettled/切会话复位。 */
  const [live, setLive] = useState(false);
  useEffect(() => {
    setLive(false);
    const offs = [
      host.events.on<PromptSentEvent>(KernelTopics.promptSent, (e) => {
        if (e.sessionId === sessionId) setLive(true);
      }),
      host.events.on<TurnSettledEvent>(KernelTopics.turnSettled, (e) => {
        if (e.sessionId === sessionId) setLive(false);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [sessionId]);

  const [missId, setMissId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  if (!sessionId) {
    return <Empty text={t("时间线跟随会话生命周期 —— 当前没有活跃会话")} />;
  }
  if (anchors.length === 0) {
    return <Empty text={t("本会话还没有用户消息 —— 发送一条后,这里按时间记录")} />;
  }

  /* 最新在顶;seq 取正序下标 +1,追加不回溯。 */
  const items = anchors.map((anchor, i) => ({ anchor, seq: i + 1 })).reverse();
  const lastId = anchors[anchors.length - 1]?.id;

  async function onJump(anchor: UserMessageAnchor) {
    if (!sessionId) return;
    const ok = await jumpToAnchor(sessionId, anchor);
    if (ok) return;
    setMissId(anchor.id);
    window.setTimeout(() => setMissId((cur) => (cur === anchor.id ? null : cur)), MISS_FLASH_MS);
  }

  function toggleOpen(id: string) {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-2 pl-1">
      {items.map(({ anchor, seq }, i) => (
        <TimelineRow
          key={anchor.id}
          anchor={anchor}
          seq={seq}
          last={i === items.length - 1}
          live={live && anchor.id === lastId}
          miss={missId === anchor.id}
          open={openIds.has(anchor.id)}
          onToggle={() => toggleOpen(anchor.id)}
          onJump={() => void onJump(anchor)}
        />
      ))}
    </div>
  );
}

function TimelineRow({
  anchor,
  seq,
  last,
  live,
  miss,
  open,
  onToggle,
  onJump,
}: {
  anchor: UserMessageAnchor;
  seq: number;
  /** 时间线最旧一条:不再向下画连接线。 */
  last: boolean;
  live: boolean;
  miss: boolean;
  open: boolean;
  onToggle: () => void;
  onJump: () => void;
}) {
  const parts = useMemo(() => extractTimelineParts(anchor.text), [anchor.text]);
  const clampable = parts.text.length > CLAMP_MIN_CHARS;

  return (
    <div
      className={`group flex gap-2 rounded-(--tmd-radius-sm) px-1.5 py-[7px] transition-colors hover:bg-(--tmd-bg-hover) ${
        miss ? "bg-(--tmd-diff-removed)/10" : ""
      }`}
    >
      {/* 左轨:圆点 + 向下连接线(最旧一条不画) */}
      <div className="relative w-3 flex-none" aria-hidden>
        {!last && <div className="absolute top-4 -bottom-2 left-[5px] w-px bg-(--tmd-border)" />}
        <span
          className={`absolute top-[7px] left-[2px] h-2 w-2 rounded-full border-2 border-(--tmd-accent) ${
            live ? "bg-(--tmd-accent)" : "bg-(--tmd-bg-base)"
          }`}
        />
      </div>

      <div className="min-w-0 flex-1">
        {/* meta:序号 + 状态 + hover 出「定位幕布」 */}
        <div className="mb-0.5 flex items-center gap-1.5 text-[0.625rem] leading-4 text-(--tmd-fg-faint)">
          <span className="font-mono font-semibold text-(--tmd-fg-muted)">#{seq}</span>
          {live && (
            <span className="rounded bg-(--tmd-accent)/15 px-1 text-(--tmd-accent)">
              {t("进行中")}
            </span>
          )}
          <button
            type="button"
            onClick={onJump}
            className="ml-auto rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 text-[0.625rem] leading-4 text-(--tmd-accent) opacity-0 transition-opacity group-hover:opacity-100"
          >
            {t("定位幕布")}
          </button>
        </div>

        {/* 净文本(对齐 BatchSheet 用户消息卡:accent 左边条);纯附件消息不出文本块 */}
        {parts.text ? (
          <div
            className={`rounded-r border-l-2 border-(--tmd-accent) bg-(--tmd-bg-hover) px-2.5 py-1.5 text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-(--tmd-fg) ${
              clampable && !open ? "line-clamp-3" : ""
            }`}
          >
            {parts.text}
          </div>
        ) : null}
        {clampable && (
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 text-[0.625rem] text-(--tmd-accent)"
          >
            {open ? t("收起") : t("展开全文")}
          </button>
        )}

        {/* 图片附件:缩略图横排 + lightbox(复用审批线消息卡件) */}
        <PromptImages images={parts.images} />

        {/* 文件附件 chip:目录截断 + 文件名常驻 */}
        {parts.files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parts.files.map((p) => {
              const slash = p.lastIndexOf("/");
              return (
                <span
                  key={p}
                  title={p}
                  className="flex max-w-full items-center gap-1 rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1.5 py-px text-[0.625rem] leading-4 text-(--tmd-fg-muted)"
                >
                  <FileText size="0.625rem" className="flex-none text-(--tmd-fg-subtle)" aria-hidden />
                  <span className="truncate font-mono text-(--tmd-fg-faint)">
                    {p.slice(0, slash + 1)}
                  </span>
                  <span className="flex-none font-mono text-(--tmd-fg)">{p.slice(slash + 1)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 摘要行右侧计数;仅时间线态挂载(订阅即轮询开关,审批线态零开销)。 */
export function TimelineCount() {
  const sessionId = host.getActiveSessionId();
  const anchors = useSyncExternalStore(messageAnchors.subscribe, () =>
    messageAnchors.getAnchors(sessionId),
  );
  return (
    <span className="flex-none text-(--tmd-fg-faint)">{t("{count} 条", { count: anchors.length })}</span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[0.6875rem] leading-relaxed text-(--tmd-fg-faint)">
      {text}
    </div>
  );
}
