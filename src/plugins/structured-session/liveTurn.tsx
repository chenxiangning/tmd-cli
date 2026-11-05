/**
 * 流内活轮渲染器(过程区与落定展开区同形 —— codemoss 活轮同律,2026-11-05
 * 二轮按用户图证对齐「图2」形态):
 * - 活轮起点由 liveFromIndex 裁决 = 最后一个用户块(引擎轮界帧在代理多步
 *   循环里逐步推进,按 turnStart 切会把在途过程错落成已定折叠组+工具行重复,
 *   2026-11-05 实锤);落定后整轮归 SsTurnView 折叠组(带「展开→收起」结算
 *   过渡),见 ssTurnView 头注。
 * - 用户块 = 气泡卡(SsUserBlock,活轮/落定同形);正文 = sv-assistant 同形。
 * - 过程区结构 = 落定展开区同形:思考 = 左轨全文段(活跃面题头 pulse 成
 *   「思考中…」),连续工具 = 树形导轨行;段落 = 块,类型切换即分段
 *   (与落定 groupSections 同律)。liveSurface 与块位置解耦(渲染层不按
 *   is-last 判断活跃,轮内第二段思考照常展开)。
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)。
 */
import { memo, type ComponentType, type ReactNode } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import type { PiLiveSurface } from "../cli-shared/piRpc";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { SsThinkingSection, SsToolSection } from "./ssTurnView";
import { SsUserBlock } from "./ssUserBlock";

export const LiveTurn = memo(function LiveTurn({ blocks, live, Markdown, thinkingLabel, liveSurface }: {
  blocks: CliTranscriptBlock[];
  /** 轮进行中渲染态(useTurnLive 宽限态):题头 pulse/尾光标/占位随它,不用裸 busy。 */
  live: boolean;
  Markdown: ComponentType<{ children: string }>;
  thinkingLabel: string;
  liveSurface: PiLiveSurface;
}) {
  const user = blocks.find((b) => b.role === "user");
  const rest = blocks.filter((b) => b.role !== "user");
  const last = rest[rest.length - 1];
  /* 流内思考块 = 最后一个 reasoning(rebuild 每轮至多一块流内思考,冻结块在前)。 */
  const liveThinkIdx = liveSurface === "thinking" ? rest.map((b) => b.role).lastIndexOf("reasoning") : -1;
  /* 过程区分段渲染:reasoning 独立成段,连续工具并入同段;system/正文常显。 */
  const sections: ReactNode[] = [];
  let toolRun: CliTranscriptBlock[] = [];
  const flushTools = () => {
    if (toolRun.length === 0) return;
    sections.push(<SsToolSection key={toolRun[0].id} blocks={toolRun} />);
    toolRun = [];
  };
  for (const [i, b] of rest.entries()) {
    if (b.role === "reasoning") {
      flushTools();
      const onAir = live && i === liveThinkIdx;
      sections.push(<SsThinkingSection key={b.id} block={b} titled live={onAir} Markdown={Markdown} />);
    } else if (b.role === "tool") {
      toolRun.push(b);
    } else if (b.role === "system") {
      flushTools();
      sections.push(<TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />);
    } else if (b.role === "assistant" && b.text) {
      flushTools();
      sections.push(<TranscriptBlockView key={b.id} block={b} Markdown={Markdown} tail={live && b === last} />);
    }
  }
  flushTools();
  return (
    <div className="ss-liveturn">
      {user ? <SsUserBlock block={user} Markdown={Markdown} /> : null}
      {live && rest.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {sections}
    </div>
  );
});
