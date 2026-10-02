/**
 * 幕布加载遮罩 —— 纯展示拆分(TerminalView 文件规模铁则收紧,同
 * terminalSearch/terminalHistory 拆法):回放期显真实解析进度,流式期显
 * 真实接收量;progress 为 null 即不渲染(撤罩语义见 terminalReplay.ts,
 * 输出静默/兜底判就绪,一旦撤下不再回弹)。
 *
 * 层级与节奏(0.2.7 打磨):z-0 = 压住静态幕布画布,但不盖右上工具行
 * (行容器 absolute z-auto 自然 painting 在其上)——回放期刷新/结构化切换
 * 保持可点,自救链路不再被罩子切断;editorCenter.canvasOverlay(z-10)仍按
 * 原意盖行。流式期进度改不确定态脉冲满条:此前 chars/5000 假百分比在 50 万
 * 字符即钉死 99% 纹丝不动,比没有进度更糟;入场 150ms fade,小会话不再硬闪。
 */
import type { LoadProgress } from "@kernel/terminalReplay";

export function TerminalLoadOverlay({ progress }: { progress: LoadProgress }) {
  if (progress === null) return null;
  const replay = progress.kind === "replay";
  return (
    <div
      className="absolute inset-0 z-0 flex items-center justify-center [animation:tmdFadeIn_.15s_ease-out]"
      style={{ background: "var(--tmd-terminal-bg)" }}
    >
      <div className="flex w-56 flex-col items-center gap-2">
        <span className="text-xs text-(--tmd-fg-muted)">
          {replay
            ? `加载会话输出… ${progress.pct}%`
            : `加载会话输出… 已接收 ${Math.max(1, Math.round(progress.chars / 1024))}K`}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-(--tmd-border)">
          {replay ? (
            /* 回放:确定性 pct(真实解析进度) */
            <div
              className="h-full bg-(--tmd-accent) transition-[width] duration-150"
              style={{ width: `${progress.pct}%` }}
            />
          ) : (
            /* 流式:不确定态脉冲满条(接收量见文案;条不再假报百分比) */
            <div
              className="h-full w-full animate-pulse"
              style={{ background: "var(--tmd-accent)", opacity: 0.5 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
