/**
 * 流内活轮渲染器(过程区全程可见,codemoss 活轮同律):
 * - 活轮起点由 liveFromIndex 裁决 = 最后一个用户块(引擎轮界帧在代理多步
 *   循环里逐步推进,按 turnStart 切会把在途过程错落成已定折叠组+工具行重复,
 *   2026-11-05 实锤);落定后整轮归 SsTurnView 折叠组(带「展开→收起」结算
 *   过渡),见 ssTurnView 头注。
 * - 用户/正文复用 session-viewer 同形组件(sv-user 署名行、sv-assistant 光标)
 *   ——活轮与落定同形,结算换装零跳变。
 * - 轮 live 期所有思考行自动展开(思考链全程可读,不再「秒过」折回单行;
 *   点击可手动接管);pulse 只打在活跃面那块。liveSurface 与块位置解耦
 *   (rebuild 布局中活思考永远排在轮级工具行之前)。
 * - 工具行 = SsToolRow(类型/文件 chip + 展开区;running 自动展开/终态折叠)。
 * - 首帧未到 = 「思考中…」shimmer 占位(InitialThinking 同款)。
 * 只渲染活轮起点之后的块;落定历史归 SsTurnView。
 */
import { memo, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import type { PiLiveSurface } from "../cli-shared/piRpc";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { ThinkingRow } from "@plugins/session-viewer/transcriptRows";
import { SsToolRow } from "./ssToolRow";
import { SsUserBlock } from "./ssUserBlock";

export const LiveTurn = memo(function LiveTurn({ blocks, live, Markdown, thinkingLabel, liveSurface }: {
  blocks: CliTranscriptBlock[];
  /** 轮进行中渲染态(useTurnLive 宽限态):思考展开/尾光标/占位随它,不用裸 busy。 */
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
  return (
    <div className="ss-liveturn">
      {/* 用户块:图片 token 内联渲染(粘贴/拖图的临时文件路径 → 图);其余同形 */}
      {user ? <SsUserBlock block={user} Markdown={Markdown} /> : null}
      {live && rest.length === 0 ? (
        <div className="ss-think is-initial"><span className="ss-shimmer">{thinkingLabel}</span></div>
      ) : null}
      {rest.map((b, i) => {
        if (b.role === "system") {
          /* 协议事件 notice(非 confirm 部件自动取消等)落活轮也立即可见。 */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} />;
        }
        if (b.role === "reasoning") {
          /* 轮 live 期思考链全程展开(输出时展开;轮完成由 SsTurnView 播总折叠
           * 过渡)——streaming 翻 false 即折回单行是「秒过」根因,pulse 只给
           * 活跃面那块标识「正在思考」。 */
          const pulsing = live && i === liveThinkIdx;
          return <ThinkingRow key={b.id} block={b} Markdown={Markdown} pulse={pulsing} streaming={live} />;
        }
        if (b.role === "tool") {
          return <SsToolRow key={b.id} block={b} />;
        }
        if (b.role === "assistant" && b.text) {
          /* 正文同形复用(tail = 末尾光标;liveSurface=text 期即流内输出面) */
          return <TranscriptBlockView key={b.id} block={b} Markdown={Markdown} tail={live && b === last} />;
        }
        return null;
      })}
    </div>
  );
});
