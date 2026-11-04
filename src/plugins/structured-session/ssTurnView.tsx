/**
 * 落定历史逐轮渲染 —— codemoss 形态(2026-11-05 幕布重构):每轮 =
 * 用户块(常显) + 过程折叠组(默认收起,头 = 「思考 N 次 · 工具调用 M 次 ›」,
 * 展开 = 思考/工具步骤按时间序) + 答复正文(常显)。不再使用 session-viewer
 * 的 PhaseFold 整卷分组,本件只在 structured-session 路径消费,PTY 零接触。
 */
import { memo, useState, type ComponentType } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { ThinkingRow } from "@plugins/session-viewer/transcriptRows";
import { SsToolRow } from "./ssToolRow";

/** 按用户块切轮(每轮以 user 块开头;无 user 块的头部残段也成一轮回退兜住)。 */
function splitTurns(blocks: CliTranscriptBlock[]): CliTranscriptBlock[][] {
  const turns: CliTranscriptBlock[][] = [];
  for (const b of blocks) {
    if (b.role === "user" || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(b);
  }
  return turns;
}

/* 过程折叠组:头一行(chip 摘要 + chevron),展开 = 思考行 + 工具行按原序。 */
function SsProcessFold({ blocks, Markdown }: {
  blocks: CliTranscriptBlock[];
  Markdown: ComponentType<{ children: string }>;
}) {
  const [open, setOpen] = useState(false);
  const thinks = blocks.filter((b) => b.role === "reasoning").length;
  const tools = blocks.filter((b) => b.role === "tool").length;
  if (thinks + tools === 0) return null;
  return (
    <div className={`ss-fold${open ? " is-open" : ""}`}>
      <button type="button" className="ss-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <CaretRight className="ss-tool-caret" aria-hidden />
        <span>
          {t("思考 {n} 次", { n: String(thinks) })} · {t("工具调用 {n} 次", { n: String(tools) })}
        </span>
      </button>
      {open ? (
        <div className="ss-fold-body">
          {blocks.map((b) =>
            b.role === "reasoning" ? (
              <ThinkingRow key={b.id} block={b} Markdown={Markdown} />
            ) : b.role === "tool" ? (
              <SsToolRow key={b.id} block={b} />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

export const SsTurnView = memo(function SsTurnView({ blocks, Markdown }: {
  blocks: CliTranscriptBlock[];
  Markdown: ComponentType<{ children: string }>;
}) {
  return (
    <>
      {splitTurns(blocks).map((turn) => {
        const process = turn.filter((b) => b.role === "reasoning" || b.role === "tool");
        /* 轮内次序:用户/系统块 → 过程折叠组 → 答复正文(codemoss 布局)。
         * 轮 key = 首块 id(切轮保证每轮非空,无数组下标)。 */
        const heads = turn.filter((b) => b.role === "user" || b.role === "system");
        const answers = turn.filter((b) => b.role === "assistant");
        return (
          <div className="ss-turn" key={turn[0].id}>
            {heads.map((b) => (
              <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />
            ))}
            <SsProcessFold blocks={process} Markdown={Markdown} />
            {answers.map((b) => (
              <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />
            ))}
          </div>
        );
      })}
    </>
  );
});
