/**
 * 幕布加载遮罩 —— 纯展示拆分(TerminalView 文件规模铁则收紧,同
 * terminalSearch/terminalHistory 拆法):回放期显真实解析进度,流式期显
 * 真实接收量;progress 为 null 即不渲染(撤罩语义见 terminalReplay.ts,
 * 输出静默/兜底判就绪,一旦撤下不再回弹)。
 */
import type { LoadProgress } from "@kernel/terminalReplay";

export function TerminalLoadOverlay({ progress }: { progress: LoadProgress }) {
  if (progress === null) return null;
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: "var(--tmd-terminal-bg)" }}
    >
      <div className="flex w-56 flex-col items-center gap-2">
        <span className="text-xs text-(--tmd-fg-muted)">
          {progress.kind === "replay"
            ? `加载会话输出… ${progress.pct}%`
            : `加载会话输出… 已接收 ${Math.max(1, Math.round(progress.chars / 1024))}K`}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-(--tmd-border)">
          <div
            className="h-full bg-(--tmd-accent) transition-[width] duration-150"
            style={{
              width:
                progress.kind === "replay"
                  ? `${progress.pct}%`
                  : `${Math.min(99, Math.round(progress.chars / 5000))}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
