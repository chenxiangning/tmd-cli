/**
 * 落定历史逐轮渲染 —— codemoss ProcessDisclosure 形态(2026-11-05 二轮重写,
 * 丝滑度对齐 codemoss 幕布)。每轮 = 用户块(常显) + 过程折叠组(默认收起,
 * 头 = 纯文本「思考 N 次 · 工具调用 M 次 ›」) + 答复正文(常显)。展开区按
 * codemoss 结构:思考段 = 左轨灰字全文块;连续工具调用 = 树形导轨行(SVG
 * 弯枝 + 干线的描画入场,行模糊淡入)。不再复用 session-viewer ThinkingRow
 * 的单行截断摘要(噪声)。开合走 grid-rows 高度动画,收起播完才卸载内容。
 * 结算换装律:settleKey = 刚落定的轮首块 id,该轮折叠组首帧以展开态挂载,
 * 一拍后自动收成折叠头(过程内容不是瞬消失,是看着它折起来)。
 * 本件只在 structured-session 路径消费,PTY 零接触。
 */
import { memo, useEffect, useRef, useState, type ComponentType } from "react";
import { Brain, CaretRight } from "@phosphor-icons/react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { SsToolRow } from "./ssToolRow";
import { SsUserBlock } from "./ssUserBlock";

/** 按用户块切轮(每轮以 user 块开头;无 user 块的头部残段也成一轮回退兜住)。 */
function splitTurns(blocks: CliTranscriptBlock[]): CliTranscriptBlock[][] {
  const turns: CliTranscriptBlock[][] = [];
  for (const b of blocks) {
    if (b.role === "user" || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(b);
  }
  return turns;
}

/* 过程段归组:保持原序;思考块独立成段,相邻工具块并入同一段工具树
 * (codemoss groupProcessSections 同款——时间序即因果可读性)。 */
type SsSection =
  | { type: "thinking"; block: CliTranscriptBlock }
  | { type: "tools"; blocks: CliTranscriptBlock[] };

function groupSections(blocks: CliTranscriptBlock[]): SsSection[] {
  const sections: SsSection[] = [];
  for (const b of blocks) {
    if (b.role === "reasoning") {
      sections.push({ type: "thinking", block: b });
    } else {
      const last = sections[sections.length - 1];
      if (last?.type === "tools") last.blocks.push(b);
      else sections.push({ type: "tools", blocks: [b] });
    }
  }
  return sections;
}

/* 思考段:Brain 题头(仅非独段时显,独段题头即折叠组头)+ 左轨灰字全文
 * (codemoss ThinkingSurface;纯文本 pre-wrap,不再 markdown 重解析)。 */
function ThinkingSection({ block, titled }: { block: CliTranscriptBlock; titled: boolean }) {
  return (
    <div className="ss-thinksec">
      {titled ? (
        <div className="ss-thinksec-title">
          <Brain size="0.875rem" aria-hidden />
          <span>{t("思考过程")}</span>
        </div>
      ) : null}
      <div className="ss-thinksec-body">{block.text}</div>
    </div>
  );
}

/* 工具段:树形导轨行;首行枝线即刻起笔,后续行等上行干线描完再接笔。 */
function ToolSection({ blocks }: { blocks: CliTranscriptBlock[] }) {
  return (
    <ul className="ss-toolsec">
      {blocks.map((b, i) => (
        <SsToolRow
          key={b.id}
          block={b}
          rail={{ first: i === 0, last: i === blocks.length - 1 }}
        />
      ))}
    </ul>
  );
}

const FOLD_MS = 300;

/* 过程折叠组:纯文本头 + grid-rows 高度开合(300ms ease-out;scaleY/opacity
 * 会留合成器残影,不用);收起动画播完才卸载展开区(codemoss bodyMounted 律)。
 * enterOpen = 结算换装:首帧展开态挂载,一拍后自动收成折叠头(只播一次;
 * 用户中途点开不再强折,playedRef 挡重播)。 */
function SsProcessFold({ blocks, enterOpen = false }: { blocks: CliTranscriptBlock[]; enterOpen?: boolean }) {
  const [open, setOpen] = useState(enterOpen);
  const [mounted, setMounted] = useState(enterOpen);
  const playedRef = useRef(false);
  useEffect(() => {
    if (!enterOpen || playedRef.current || !open) return;
    playedRef.current = true;
    const timer = window.setTimeout(() => setOpen(false), 360);
    return () => window.clearTimeout(timer);
  }, [enterOpen, open]);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const thinks = blocks.filter((b) => b.role === "reasoning").length;
  const tools = blocks.length - thinks;
  if (blocks.length === 0) return null;
  const sections = groupSections(blocks);
  const singleThinking = sections.length === 1 && sections[0].type === "thinking";
  const summary =
    thinks > 0 && tools > 0
      ? `${t("思考 {n} 次", { n: String(thinks) })} · ${t("工具调用 {n} 次", { n: String(tools) })}`
      : thinks > 0
        ? t("思考 {n} 次", { n: String(thinks) })
        : t("工具调用 {n} 次", { n: String(tools) });
  return (
    <div className={`ss-fold${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="ss-fold-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CaretRight size="0.75rem" className="ss-tool-caret" aria-hidden />
        <span>{summary}</span>
      </button>
      <div className="ss-fold-clip">
        <div>
          {mounted ? (
            <div className="ss-fold-body">
              {sections.map((s) =>
                s.type === "thinking" ? (
                  <ThinkingSection key={s.block.id} block={s.block} titled={!singleThinking} />
                ) : (
                  <ToolSection key={s.blocks[0].id} blocks={s.blocks} />
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const SsTurnView = memo(function SsTurnView({ blocks, Markdown, settleKey = null }: {
  blocks: CliTranscriptBlock[];
  Markdown: ComponentType<{ children: string }>;
  /** 刚落定轮的首块 id(= 该轮用户块):其折叠组播「展开→收起」结算过渡一次。 */
  settleKey?: string | null;
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
            {heads.map((b) =>
              b.role === "user" ? (
                <SsUserBlock key={b.id} block={b} Markdown={Markdown} />
              ) : (
                <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />
              ),
            )}
            <SsProcessFold blocks={process} enterOpen={turn[0].id === settleKey} />
            {answers.map((b) => (
              <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />
            ))}
          </div>
        );
      })}
    </>
  );
});
