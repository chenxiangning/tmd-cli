/**
 * 流内活轮渲染器(monocode AgentTranscript 活动段同款交互):
 * - 思考 = 单行脉冲摘要流式滚动(点击展开全文;monocode ActivityThinkingRow 同语义)
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)
 * - 正文 = markdown 渲染 + 末尾光标脉冲(流式体感)
 * - 工具行 = 盲文 spinner(running)/✓(done)/✕(error) + 标签 + 预览子行 + 可展开输出
 * 只渲染 turnStart 之后的活块;落定历史归 TranscriptView(同形块,结算零跳变)。
 */
import { memo, useEffect, useState, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { proseSummary, tailLines, toolRowLabel } from "@plugins/session-viewer/transcriptPhases";

const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 盲文 spinner(80ms/帧,monocode TerminalSpinner 同款)。 */
function Spinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % SPIN_FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, []);
  return <span className="ss-spin" aria-hidden>{SPIN_FRAMES[i]}</span>;
}

/** 思考行:摘要单行脉冲,点击展开全文(流式期摘要随 delta 滚动)。 */
function ThinkingRow({ block, streaming }: { block: CliTranscriptBlock; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = proseSummary(block.text) || "…";
  return (
    <div className="ss-think">
      <button
        type="button"
        className={`ss-think-line${streaming ? " is-stream" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ss-think-dash" aria-hidden>−</span>
        <span className="ss-think-summary">{summary}</span>
      </button>
      {open ? <pre className="ss-think-full">{block.text}</pre> : null}
    </div>
  );
}

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
        {running ? <Spinner /> : (
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
      {user ? <div className="ss-live-user">{user.text}</div> : null}
      {busy && live.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {live.map((b) => {
        if (b.role === "reasoning") {
          return <ThinkingRow key={b.id} block={b} streaming={busy && b === last} />;
        }
        if (b.role === "tool") {
          return <ToolRow key={b.id} block={b} />;
        }
        if (b.role === "assistant" && b.text) {
          return (
            <div key={b.id} className="ss-live-prose">
              <Markdown>{b.text}</Markdown>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
});
