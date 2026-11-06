/**
 * 转录块渲染 —— RPC(structured-session)渲染体系的共享底座:
 * TranscriptBlockView 供 SsTurnView/LiveTurn 渲染 system/assistant 块
 * (用户块走 SsUserBlock 气泡卡,思考/工具过程走 SsThinkingSection/
 * SsToolRow —— 整卷分组渲染即 structured-session 的 SsTurnView/LiveTurn,
 * PTY 查看转录与 RPC 会话共用一套,2026-11-05 渲染对齐);Timestamp 为
 * 块头时间戳原语(ssUserBlock 同款消费)。
 */

import { memo, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";

import { capped } from "./transcriptPhases";

/** md 渲染组件协议(lazy 拆包,调用方注入)。 */
export type MarkdownRenderer = ComponentType<{ children: string }>;

/** 块时间戳(role 行;缺省不渲染)。 */
export function Timestamp({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <span className="sv-ts">
      {new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/** 单块渲染入口(SsTurnView/LiveTurn 消费):system 淡色行;assistant 全尺寸 md。 */
/* memo:流式增量追加时 block 引用不变即跳过(react-markdown v10 零内部
 * 缓存,重挂载即全量重跑 remark/rehype;Markdown prop 为调用方模块级
 * lazy 常量,引用恒稳)。 */
export const TranscriptBlockView = memo(function TranscriptBlockView({
  block,
  Markdown,
  tail,
}: {
  block: CliTranscriptBlock;
  Markdown: MarkdownRenderer;
  /** 轮进行中的卷尾块:正文光标(monocode 流式观感;数据仍是 message 级)。 */
  tail?: boolean;
}) {
  if (block.role === "system") {
    return <div className="sv-system">{block.text}</div>;
  }
/* 块头不再挂「AI」角色行(2026-11-06 用户裁决:omp RPC 每 chunk 一块,
 * 逐块 AI 标记既噪又撑段落留白;时间戳保留,缺省不渲染)。 */
  return (
    <div className={`sv-assistant${tail ? " sv-tail" : ""}`}>
      <Timestamp ms={block.startedAt} />
      <Markdown>{capped(block.text)}</Markdown>
    </div>
  );
});
