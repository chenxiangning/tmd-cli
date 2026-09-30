/**
 * 转录渲染 —— codemoss process-phase 形态:
 * - user 卡(左缘强调)+ assistant 全尺寸 markdown(正文永不折叠);
 * - 工作过程 = 折叠组(PhaseFold):折叠头单行(chevron + 摘要 + 步数),
 *   默认收起;正文只折叠其上方紧邻的工作过程,自身常显;
 *   展开后组内为逐行 step(思考行 = Minus + 单行摘要,点击展开淡色
 *   markdown;工具行 = 动词 + mono 目标,点击展开 preview);
 * - agent-reasoning 正文 48% 透明(monocode 同款阅读层级)。
 */

import { memo, useMemo, useState, type ComponentType } from "react";
import type { CliTranscriptBlock, CliTranscriptImage } from "@kernel/cli";
import { t } from "@kernel/i18n";

import { buildTranscriptPhases, makeKeySeq, capped } from "./transcriptPhases";
import { PhaseFold, ThinkingRow, Timestamp } from "./transcriptRows";

/** md 渲染组件协议(lazy 拆包,viewerTab 注入)。 */
export type MarkdownRenderer = ComponentType<{ children: string }>;

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
  tail,
}: {
  block: CliTranscriptBlock;
  Markdown: MarkdownRenderer;
  /** 轮次进行中的卷尾块:思考脉冲/正文光标(monocode 流式观感;数据仍是 message 级)。 */
  tail?: boolean;
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
  if (block.role === "reasoning") {
    return <ThinkingRow block={block} Markdown={Markdown} pulse={tail} />;
  }
  return (
    <div className={`sv-assistant${tail ? " sv-tail" : ""}`}>
      <div className="sv-role-row">
        <span className="sv-role-label">{t("AI")}</span>
        <Timestamp ms={block.startedAt} />
      </div>
      <Markdown>{capped(block.text)}</Markdown>
    </div>
  );
});

/** 整卷渲染(user/assistant 全尺寸正文与工作折叠组混排;minimal = 极简展示)。 */
export function TranscriptView({
  blocks,
  Markdown,
  minimal,
  streaming,
}: {
  blocks: CliTranscriptBlock[];
  Markdown: MarkdownRenderer;
  minimal?: boolean;
  /** 轮次进行中:最后一个 reasoning/assistant 块给流式观感(脉冲/光标)。 */
  streaming?: boolean;
}) {
  const items = useMemo(() => buildTranscriptPhases(blocks, { minimal }), [blocks, minimal]);
  const itemKey = makeKeySeq();
  /* 卷尾流式:轮次进行中,最后一个工作组自动展开(活过程可见,monocode 同律);
   * 最后一个是裸 reasoning/assistant 块时给脉冲/光标观感。结算后收回折叠。 */
  const last = items[items.length - 1];
  const livePhaseOpen = streaming && last?.kind === "phase";
  const tailId =
    streaming && last && last.kind !== "phase" && (last.block.role === "reasoning" || last.block.role === "assistant")
      ? last.block.id
      : null;
  return (
    <>
      {items.map((item, i) =>
        item.kind === "phase" ? (
          <PhaseFold
            key={itemKey(item.phase.id)}
            phase={item.phase}
            Markdown={Markdown}
            forceOpen={livePhaseOpen && i === items.length - 1}
          />
        ) : (
          <TranscriptBlockView
            key={itemKey(item.block.id)}
            block={item.block}
            Markdown={Markdown}
            tail={item.block.id === tailId}
          />
        ),
      )}
    </>
  );
}
