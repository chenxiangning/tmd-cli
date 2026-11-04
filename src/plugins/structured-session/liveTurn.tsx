/**
 * 流内活轮渲染器(monocode AgentTranscript 活动段同款交互):
 * - 用户/正文/思考 = 直接复用 session-viewer 同形组件(sv-user 署名行、
 *   sv-assistant 光标、ThinkingRow 脉冲摘要)——活轮与落定同形,结算零跳变
 *   不再是声明而是结构保证;流式观感靠 tail/pulse。
 * - 工具行 = SsToolRow(类型/文件 chip + 展开区;running 自动展开/终态折叠),
 *   落定后归 TranscriptView 折叠组。
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)。
 * 只渲染 turnStart 之后的活块;落定历史归 TranscriptView。
 */
import { memo, type ComponentType, type ReactNode } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { ThinkingRow } from "@plugins/session-viewer/transcriptRows";
import { SsToolRow } from "./ssToolRow";

export const LiveTurn = memo(function LiveTurn({ blocks, busy, Markdown, thinkingLabel, wrap }: {
  blocks: CliTranscriptBlock[];
  busy: boolean;
  Markdown: ComponentType<{ children: string }>;
  thinkingLabel: string;
  /** 长正文包装器(可选折叠);缺省原样,共享件语义不变。 */
  wrap?: ComponentType<{ children: ReactNode }>;
}) {
  const user = blocks.find((b) => b.role === "user");
  const live = blocks.filter((b) => b.role !== "user");
  const last = live[live.length - 1];
  return (
    <div className="ss-liveturn">
      {/* 用户块复用落定同形组件(署名行/时间戳/强调线):结算瞬间不再换装 */}
      {user ? <TranscriptBlockView block={user} Markdown={Markdown} wrap={wrap} /> : null}
      {busy && live.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {live.map((b) => {
        if (b.role === "system") {
          /* 协议事件 notice(非 confirm 部件自动取消等)落活轮也立即可见。 */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />;
        }
        if (b.role === "reasoning") {
          /* 思考行同形复用(pulse = 流式脉冲;streaming = 该段输出中自动展开,
           * 段落落定自动折回单行摘要——与工具行 running 展开/终态折叠同律) */
          return <ThinkingRow key={b.id} block={b} Markdown={Markdown} pulse={busy && b === last} streaming={busy && b === last} />;
        }
        if (b.role === "tool") {
          return <SsToolRow key={b.id} block={b} />;
        }
        if (b.role === "assistant" && b.text) {
          /* 正文同形复用(tail = 末尾光标;署名行/markdown 与落定一致) */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} tail={busy && b === last} wrap={wrap} />;
        }
        return null;
      })}
    </div>
  );
});
