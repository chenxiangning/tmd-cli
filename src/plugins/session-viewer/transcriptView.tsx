/**
 * 转录渲染 —— codemoss process-phase 形态:
 * - user 卡(左缘强调)+ assistant 全尺寸 markdown(正文永不折叠);
 * - 工作过程 = 折叠组(PhaseFold):折叠头单行(chevron + 摘要 + 步数),
 *   默认收起;正文只折叠其上方紧邻的工作过程,自身常显;
 *   展开后组内为逐行 step(思考行 = Minus + 单行摘要,点击展开淡色
 *   markdown;工具行 = 动词 + mono 目标,点击展开 preview);
 * - agent-reasoning 正文 48% 透明(monocode 同款阅读层级)。
 */

import { memo, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { CliTranscriptBlock, CliTranscriptImage } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { CaretRightIcon, MinusIcon, BookOpenIcon, PencilSimpleIcon, TerminalIcon, BrainIcon } from "@phosphor-icons/react";
import { buildTranscriptPhases, phaseTitle, proseSummary, toolRowLabel, type PhaseKind, type TranscriptPhase } from "./transcriptPhases";

/** md 渲染组件协议(lazy 拆包,viewerTab 注入)。 */
export type MarkdownRenderer = ComponentType<{ children: string }>;

/** 正文截断:10k 字符(超长正文留头部)。工具输出截断:留尾部 2k 行。 */
const TEXT_CAP = 10_000;
const OUTPUT_TAIL_LINES = 2_000;

function capped(text: string): string {
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
}

function tailedOutput(output: string): string {
  const lines = output.split("\n");
  return lines.length > OUTPUT_TAIL_LINES
    ? `…\n${lines.slice(-OUTPUT_TAIL_LINES).join("\n")}`
    : output;
}

function Timestamp({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <span className="sv-ts">
      {new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

const PHASE_ICON: Record<PhaseKind, ReactNode> = {
  look: <BookOpenIcon size="0.875rem" />,
  change: <PencilSimpleIcon size="0.875rem" />,
  run: <TerminalIcon size="0.875rem" />,
  think: <BrainIcon size="0.875rem" />,
};

/** 思考行(monocode ActivityThinkingRow):Minus + 单行摘要,点击展开淡色 md。 */
function ThinkingRow({ block, Markdown }: { block: CliTranscriptBlock; Markdown: MarkdownRenderer }) {
  const [open, setOpen] = useState(false);
  const summary = proseSummary(block.text) || t("思考");
  return (
    <div className="sv-think">
      <button
        type="button"
        className="sv-think-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MinusIcon size="0.875rem" className="sv-think-dash" />
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
function ToolRow({
  block,
  Markdown,
}: {
  block: CliTranscriptBlock;
  Markdown: MarkdownRenderer;
}) {
  const [open, setOpen] = useState(false);
  const done = block.tool?.status === "done";
  return (
    <div className="sv-tool">
      <button
        type="button"
        className="sv-tool-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <CaretRightIcon size="0.75rem" className={`sv-caret${open ? " is-open" : ""}`} />
        <span className="sv-tool-label">{toolRowLabel(block)}</span>
        {!done ? <span className="sv-tool-status">{t("已调用")}</span> : null}
        <Timestamp ms={block.startedAt} />
      </button>
      {open ? <ToolPreviewBody block={block} Markdown={Markdown} /> : null}
    </div>
  );
}

/** 工作折叠组(monocode WorkFoldLine + ActivityPhases):默认收起。 */
const PhaseFold = memo(function PhaseFold({
  phase,
  Markdown,
}: {
  phase: TranscriptPhase;
  Markdown: MarkdownRenderer;
}) {
  const [open, setOpen] = useState(false);
  const steps = phase.steps;
  /* 同文撞号防线:step.id 是内容哈希语义(grok 同文连发撞号),重复序号
     后缀唯一化(UserImages 同款;4 处 key 依赖同一锁步计数)。 */
  const seenIds = new Map<string, number>();
  const stepKey = (id: string): string => {
    const n = (seenIds.get(id) ?? 0) + 1;
    seenIds.set(id, n);
    return n > 1 ? `${id}#${n}` : id;
  };
  return (
    <div className={`sv-phase${open ? " open" : ""}`}>
      <button
        type="button"
        className="sv-phase-head"
        aria-expanded={open}
        aria-label={open ? t("收起工作过程") : t("展开工作过程")}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <CaretRightIcon size="0.875rem" className="sv-caret is-open" />
        ) : (
          PHASE_ICON[phase.kind]
        )}
        <span className="sv-phase-title">{phaseTitle(phase)}</span>
        <span className="sv-phase-count">
          {t("{n} 步", { n: String(steps.length) })}
        </span>
      </button>
      {open ? (
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
            return null;
          })}
        </div>
      ) : null}
    </div>
  );
});

/** 用户消息内嵌图片行(base64 data URI;点击缩略/整幅切换)。 */
function UserImages({ images }: { images: CliTranscriptImage[] }) {
  const [zoom, setZoom] = useState(false);
  /* key = 内容指纹 + 重复序号(同图多贴也唯一;不用数组下标)。 */
  const seen = new Map<string, number>();
  return (
    <div className={`sv-user-imgs${zoom ? " zoom" : ""}`}>
      {images.map((img) => {
        const base = `${img.mimeType}:${img.data.length}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return (
          <button key={n ? `${base}#${n}` : base} type="button" className="sv-user-img-btn" aria-label={t("切换图片大小")} onClick={() => setZoom(!zoom)}>
            <img className="sv-user-img" src={`data:${img.mimeType};base64,${img.data}`} alt="" />
          </button>
        );
      })}
    </div>
  );
}

/** 单块渲染入口(viewerTab 消费):按分组模型分发。 */
/* memo:分批触底追加时 block 引用不变即跳过(react-markdown v10 零内部
 * 缓存,重挂载即全量重跑 remark/rehype;Markdown prop 为 viewerTab 模块级
 * lazy 常量,引用恒稳)。 */
export const TranscriptBlockView = memo(function TranscriptBlockView({
  block,
  Markdown,
}: {
  block: CliTranscriptBlock;
  Markdown: MarkdownRenderer;
}) {
  if (block.role === "system") {
    return <div className="sv-system">{block.text}</div>;
  }
  if (block.role === "user") {
    return (
      <div className="sv-user">
        <div className="sv-role-row">
          <span className="sv-role-label">{t("你")}</span>
          <Timestamp ms={block.startedAt} />
        </div>
        {block.text ? <Markdown>{capped(block.text)}</Markdown> : null}
        {block.images?.length ? <UserImages images={block.images} /> : null}
      </div>
    );
  }
  return (
    <div className="sv-assistant">
      <div className="sv-role-row">
        <span className="sv-role-label">{t("AI")}</span>
        <Timestamp ms={block.startedAt} />
      </div>
      <Markdown>{capped(block.text)}</Markdown>
    </div>
  );
});

/** 整卷渲染(user/assistant 全尺寸正文与工作折叠组混排)。 */
export function TranscriptView({
  blocks,
  Markdown,
}: {
  blocks: CliTranscriptBlock[];
  Markdown: MarkdownRenderer;
}) {
  const items = useMemo(() => buildTranscriptPhases(blocks), [blocks]);
  /* 撞号防线同 PhaseFold:块/组 id 是内容哈希语义(grok 同文连发撞号),
     重复序号后缀唯一化;items 前缀稳定,键跨批次追加恒定。 */
  const seenIds = new Map<string, number>();
  const itemKey = (id: string): string => {
    const n = (seenIds.get(id) ?? 0) + 1;
    seenIds.set(id, n);
    return n > 1 ? `${id}#${n}` : id;
  };
  return (
    <>
      {items.map((item) =>
        item.kind === "phase" ? (
          <PhaseFold key={itemKey(item.phase.id)} phase={item.phase} Markdown={Markdown} />
        ) : (
          <TranscriptBlockView
            key={itemKey(item.block.id)}
            block={item.block}
            Markdown={Markdown}
          />
        ),
      )}
    </>
  );
}
