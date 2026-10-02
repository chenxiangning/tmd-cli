/**
 * 流内活轮渲染器(monocode AgentTranscript 活动段同款交互):
 * - 用户/正文/思考 = 直接复用 session-viewer 同形组件(sv-user 署名行、
 *   sv-assistant 光标、ThinkingRow 脉冲摘要)——活轮与落定同形,结算零跳变
 *   不再是声明而是结构保证;流式观感靠 tail/pulse。
 * - 工具行 = 统一 Spinner 原语(running)/✓(done)/✕(error) + 标签 + 可展开
 *   实时输出尾段(running 自动展开/终态折叠,落定后归 TranscriptView 折叠组)。
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)。
 * 只渲染 turnStart 之后的活块;落定历史归 TranscriptView。
 */
import { memo, useState, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { Spinner } from "@kernel/Spinner";
import { tailLines, toolRowLabel } from "@plugins/session-viewer/transcriptPhases";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { ThinkingRow } from "@plugins/session-viewer/transcriptRows";

/** 工具行(monocode 律):运行中自动展开实时输出尾段(partialResult 增量),完成/出错自动折叠回行。 */
/* 工具行开关律(running 自动展开/终态折叠/手动接管):单卡片状态机,无可拆。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
function ToolRow({ block }: { block: CliTranscriptBlock }) {
  const status = block.tool?.status ?? "running";
  const running = status === "running";
  const [manual, setManual] = useState<boolean | null>(null);
  /* null = 跟随自动律:running 展开 / 终态折叠;点击后手动接管。 */
  const open = manual ?? running;
  const preview = block.tool?.preview;
  const detail = block.tool?.detail?.trim();
  return (
    <div className={`ss-toolrow${running ? " is-running" : ""}`}>
      <button
        type="button"
        className="ss-toolrow-head"
        aria-expanded={open}
        onClick={() => setManual(!(manual ?? running))}
      >
        {/* 运行态走统一 Spinner 原语(12px 行内档;原盲文 80ms interval 副本已收口) */}
        {running ? <Spinner size="0.75rem" /> : (
          <span className={`ss-tool-mark${status === "error" ? " is-error" : ""}`} aria-hidden>
            {status === "error" ? "✕" : "✓"}
          </span>
        )}
        <span className="ss-toolrow-label">{toolRowLabel(block)}</span>
      </button>
      {preview?.path ? <div className="ss-toolrow-path">{preview.path}</div> : null}
      {preview?.output ? <pre className="ss-toolrow-cmd">{preview.output}</pre> : null}
      {open && detail ? <pre className={`ss-toolrow-out${running ? " is-live" : ""}`}>{running ? tailLines(detail) : detail}</pre> : null}
    </div>
  );
}

export const LiveTurn = memo(function LiveTurn({ blocks, busy, Markdown, thinkingLabel }: {
  blocks: CliTranscriptBlock[];
  busy: boolean;
  Markdown: ComponentType<{ children: string }>;
  thinkingLabel: string;
}) {
  const user = blocks.find((b) => b.role === "user");
  const live = blocks.filter((b) => b.role !== "user");
  const last = live[live.length - 1];
  return (
    <div className="ss-liveturn">
      {/* 用户块复用落定同形组件(署名行/时间戳/强调线):结算瞬间不再换装 */}
      {user ? <TranscriptBlockView block={user} Markdown={Markdown} /> : null}
      {busy && live.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {live.map((b) => {
        if (b.role === "system") {
          /* 协议事件 notice(非 confirm 部件自动取消等)落活轮也立即可见。 */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />;
        }
        if (b.role === "reasoning") {
          /* 思考行同形复用(pulse = 流式脉冲;展开体 markdown 与落定一致) */
          return <ThinkingRow key={b.id} block={b} Markdown={Markdown} pulse={busy && b === last} />;
        }
        if (b.role === "tool") {
          return <ToolRow key={b.id} block={b} />;
        }
        if (b.role === "assistant" && b.text) {
          /* 正文同形复用(tail = 末尾光标;署名行/markdown 与落定一致) */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} tail={busy && b === last} />;
        }
        return null;
      })}
    </div>
  );
});
