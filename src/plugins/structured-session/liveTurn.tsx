/**
 * 流内活轮渲染器(monocode AgentTranscript 活动段同款交互):
 * - 用户/正文复用 session-viewer 同形组件(sv-user 署名行、sv-assistant 光标)
 *   ——活轮与落定同形,结算零跳变不再是声明而是结构保证;流式观感靠 surface。
 * - 流式展开判据 = reducer 的 liveSurface(活思考/正文),不是 is-last —— rebuild
 *   布局中活思考永远排在轮级工具行之前,位置判据会让轮内第二段起的思考与
 *   「思考→工具→再思考」链全部失焦(2026-11-05 幕布流缺陷实锤)。surface
 *   命中且为该角色的最后一块(= 流内那块)即展开;面切走/消息结算即折回。
 * - 工具行 = SsToolRow(类型/文件 chip + 展开区;running 自动展开/终态折叠),
 *   落定后归 SsTurnView 折叠组。
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)。
 * 只渲染 turnStart 之后的活块;落定历史归 SsTurnView。
 */
import { memo, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import type { PiLiveSurface } from "../cli-shared/piRpc";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { ThinkingRow } from "@plugins/session-viewer/transcriptRows";
import { SsToolRow } from "./ssToolRow";
import { SsUserBlock } from "./ssUserBlock";

export const LiveTurn = memo(function LiveTurn({ blocks, busy, Markdown, thinkingLabel, liveSurface }: {
  blocks: CliTranscriptBlock[];
  busy: boolean;
  Markdown: ComponentType<{ children: string }>;
  thinkingLabel: string;
  liveSurface: PiLiveSurface;
}) {
  const user = blocks.find((b) => b.role === "user");
  const live = blocks.filter((b) => b.role !== "user");
  const last = live[live.length - 1];
  /* 流内思考块 = 最后一个 reasoning(rebuild 每轮至多一块流内思考,冻结块在前)。 */
  const liveThinkIdx = liveSurface === "thinking" ? live.map((b) => b.role).lastIndexOf("reasoning") : -1;
  return (
    <div className="ss-liveturn">
      {/* 用户块:图片 token 内联渲染(粘贴/拖图的临时文件路径 → 图);其余同形 */}
      {user ? <SsUserBlock block={user} Markdown={Markdown} /> : null}
      {busy && live.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {live.map((b, i) => {
        if (b.role === "system") {
          /* 协议事件 notice(非 confirm 部件自动取消等)落活轮也立即可见。 */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />;
        }
        if (b.role === "reasoning") {
          /* surface=thinking 时流内思考展开(pulse 同块);面切走或消息结算
           * 即折回单行摘要——输出时展开、按段落折叠的段落单位就是块。 */
          const streaming = busy && i === liveThinkIdx;
          return <ThinkingRow key={b.id} block={b} Markdown={Markdown} pulse={streaming} streaming={streaming} />;
        }
        if (b.role === "tool") {
          return <SsToolRow key={b.id} block={b} />;
        }
        if (b.role === "assistant" && b.text) {
          /* 正文同形复用(tail = 末尾光标;liveSurface=text 期即流内输出面) */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} tail={busy && b === last} />;
        }
        return null;
      })}
    </div>
  );
});
