/**
 * 转录行组件(自 transcriptView 拆出,守 300 行铁则):
 * ThinkingRow / ToolPreviewBody / ToolRow / PhaseFold(工作折叠组)。
 * PhaseFold.forceOpen = 轮次进行中活过程组自动展开(monocode 同律)。
 */
import { memo, useRef, useState, type ReactNode } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { CaretRightIcon, MinusIcon, PlusIcon, BookOpenIcon, PencilSimpleIcon, TerminalIcon, BrainIcon } from "@phosphor-icons/react";
import { makeKeySeq, phaseTitle, proseSummary, toolRowLabel, capped, type PhaseKind, type TranscriptPhase } from "./transcriptPhases";
import type { MarkdownRenderer } from "./transcriptView";

/** 正文截断:10k 字符(超长正文留头部)。工具输出截断:留尾部 2k 行。 */
const OUTPUT_TAIL_LINES = 2_000;

export function Timestamp({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <span className="sv-ts">
      {new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function tailedOutput(output: string): string {
  const lines = output.split("\n");
  return lines.length > OUTPUT_TAIL_LINES
    ? `…\n${lines.slice(-OUTPUT_TAIL_LINES).join("\n")}`
    : output;
}

const PHASE_ICON: Record<PhaseKind, ReactNode> = {
  look: <BookOpenIcon size="0.875rem" />,
  change: <PencilSimpleIcon size="0.875rem" />,
  run: <TerminalIcon size="0.875rem" />,
  think: <BrainIcon size="0.875rem" />,
};

/** 思考行(monocode ActivityThinkingRow):+/− 随开合切换 + 单行摘要,点击展开淡色 md。 */
export function ThinkingRow({ block, Markdown, pulse }: { block: CliTranscriptBlock; Markdown: MarkdownRenderer; pulse?: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = proseSummary(block.text) || t("思考");
  return (
    <div className="sv-think">
      <button
        type="button"
        className={`sv-think-head${pulse ? " is-stream" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <MinusIcon size="0.875rem" className="sv-think-dash" />
        ) : (
          <PlusIcon size="0.875rem" className="sv-think-dash" />
        )}
        <span className="sv-think-summary">{summary}</span>
      </button>
      {open ? (
        <div className="sv-think-body">
          <Markdown>{capped(block.text)}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

/** 工具展开体:路径/命令/diff 行/输出。 */
function ToolPreviewBody({ block, Markdown }: { block: CliTranscriptBlock; Markdown: MarkdownRenderer }) {
  const preview = block.tool?.preview;
  return (
    <div className="sv-tool-body">
      {preview?.path ? <div className="sv-tool-path">{preview.path}</div> : null}
      {preview?.kind === "shell" && preview.output ? (
        <pre className="sv-tool-cmd">{preview.output}</pre>
      ) : null}
      {preview?.lines && preview.lines.length > 0 ? (
        <pre className="sv-tool-diff">
          {preview.lines.map((line, index) => (
            <span key={index} className={`sv-dl sv-dl-${line.kind}`}>
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : null}
      {block.tool?.detail ? (
        <pre className="sv-tool-out">{tailedOutput(block.tool.detail)}</pre>
      ) : block.text ? (
        <Markdown>{tailedOutput(block.text)}</Markdown>
      ) : null}
    </div>
  );
}

/** 工具行:动词 + mono 目标单行;点击展开命令/diff/输出。 */
export function ToolRow({
  block,
  Markdown,
}: {
  block: CliTranscriptBlock;
  Markdown: MarkdownRenderer;
}) {
  const [open, setOpen] = useState(false);
  const status = block.tool?.status;
  const error = status === "error";
  return (
    <div className="sv-tool">
      <button
        type="button"
        className="sv-tool-head"
        aria-expanded={open}
        /* path 副行收起时并入头行 title(展开态副行自显,不重复挂 title)。 */
        title={!open ? block.tool?.preview?.path : undefined}
        onClick={() => setOpen(!open)}
      >
        <CaretRightIcon size="0.75rem" className={`sv-caret${open ? " is-open" : ""}`} />
        <span className="sv-tool-label">{toolRowLabel(block)}</span>
        {status === "done" || error ? (
          <span className={`sv-tool-mark${error ? " is-err" : ""}`}>{error ? "✕" : "✓"}</span>
        ) : (
          <span className="sv-tool-status">{t("已调用")}</span>
        )}
        <Timestamp ms={block.startedAt} />
      </button>
      {open && block.tool?.preview?.path ? <div className="sv-tool-subline">{block.tool.preview.path}</div> : null}
      {open ? <ToolPreviewBody block={block} Markdown={Markdown} /> : null}
    </div>
  );
}

/** 工作折叠组(monocode WorkFoldLine + ActivityPhases):默认收起。 */
export const PhaseFold = memo(function PhaseFold({
  phase,
  Markdown,
  forceOpen,
}: {
  phase: TranscriptPhase;
  Markdown: MarkdownRenderer;
  /** 轮次进行中:活过程组自动展开;用户点过后以用户为准(点过收起不再被顶开,反之亦然)。 */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /* forceOpen 吞点击修复:流式期「点折叠头执行 setOpen(true) 画面不动、aria 恒
   * 展开且结算后状态反转」——引入 touchedRef,用户点过即以 open 为准,forceOpen
   * 只在未交互时生效。 */
  const touchedRef = useRef(false);
  const steps = phase.steps;
  const stepKey = makeKeySeq();
  const shown = touchedRef.current ? open : open || forceOpen === true;
  return (
    <div className={`sv-phase${shown ? " open" : ""}`}>
      <button
        type="button"
        className="sv-phase-head"
        aria-expanded={shown}
        aria-label={shown ? t("收起工作过程") : t("展开工作过程")}
        onClick={() => {
          touchedRef.current = true;
          setOpen(!shown);
        }}
      >
        {PHASE_ICON[phase.kind]}
        <CaretRightIcon size="0.75rem" className={`sv-caret${shown ? " is-open" : ""}`} />
        <span className="sv-phase-title">{phaseTitle(phase)}</span>
        <span className="sv-phase-count">
          {t("{n} 步", { n: String(steps.length) })}
        </span>
      </button>
      {shown ? (
        <div className="sv-phase-body">
          {steps.map((step) => {
            const key = stepKey(step.id);
            if (step.role === "reasoning") {
              return <ThinkingRow key={key} block={step} Markdown={Markdown} />;
            }
            if (step.role === "tool") {
              return <ToolRow key={key} block={step} Markdown={Markdown} />;
            }
            if (step.role === "system") {
              return (
                <div key={key} className="sv-system">
                  {step.text}
                </div>
              );
            }
            /* 极简模式组内的中途叙述 assistant:淡色 note 行,走 Markdown(与同组
             * reasoning 同律,markdown 语法不再裸奔)。 */
            return (
              <div key={key} className="sv-phase-note">
                <Markdown>{capped(step.text)}</Markdown>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

