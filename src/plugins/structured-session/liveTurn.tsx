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
 * - 滚动批次折叠(2026-11-06 spec):过程块(reasoning|tool)恒定只全文展示最新 3
 *   个(窗内必含思考,见 splitLiveWindow),更早的收成一个可点开的折叠组头
 *   (复用 SsProcessFold,形态同落定态整体折叠头);轮落定后整轮归 SsTurnView
 *   整体折叠,批次状态零残留。
 */
import { memo, type ComponentType, type ReactNode } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import type { PiLiveSurface } from "../cli-shared/piRpc";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { SsProcessFold, SsThinkingSection, SsToolSection } from "./ssTurnView";
import { SsUserBlock } from "./ssUserBlock";
import { splitLiveWindow } from "./ssLiveWindow";

/* 过程区分段渲染(抽离组件,守 react-doctor 控制流复杂度):reasoning 独立成段,
 * 连续工具并入同段;system/正文常显。批次折叠的 head 块跳过,在首个 head 块
 * 位置渲染一次折叠组头(head 恒前置于可见窗,位置唯一)。 */
function buildLiveSections(rest: CliTranscriptBlock[], live: boolean, liveSurface: PiLiveSurface, Markdown: ComponentType<{ children: string }>, head: CliTranscriptBlock[]): ReactNode[] {
  const headIds = new Set(head.map((b) => b.id));
  const last = rest[rest.length - 1];
  /* 流内思考块 = 最后一个 reasoning(rebuild 每轮至多一块流内思考,冻结块在前)。 */
  const liveThinkIdx = liveSurface === "thinking" ? rest.map((b) => b.role).lastIndexOf("reasoning") : -1;
  const sections: ReactNode[] = [];
  let toolRun: CliTranscriptBlock[] = [];
  const flushTools = () => {
    if (toolRun.length === 0) return;
    sections.push(<SsToolSection key={toolRun[0].id} blocks={toolRun} />);
    toolRun = [];
  };
  let headMounted = false;
  for (const [i, b] of rest.entries()) {
    if ((b.role === "reasoning" || b.role === "tool") && headIds.has(b.id)) {
      if (!headMounted) {
        headMounted = true;
        sections.push(<SsProcessFold key="ss-live-head" blocks={head} Markdown={Markdown} />);
      }
      continue;
    }
    if (b.role === "reasoning") {
      flushTools();
      sections.push(<SsThinkingSection key={b.id} block={b} titled live={live && i === liveThinkIdx} Markdown={Markdown} />);
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
  return sections;
}

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
  /* 批次折叠切分:更早的过程块收进折叠头,窗内无思考时换入最近思考(见 ssLiveWindow)。 */
  const { head } = splitLiveWindow(rest.filter((b) => b.role === "reasoning" || b.role === "tool"));
  const sections = buildLiveSections(rest, live, liveSurface, Markdown, head);
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
