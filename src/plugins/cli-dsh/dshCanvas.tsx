/**
 * dsh 会话中央面 —— dsh 只有 web profile(无 TUI),对话 UI 由本地 host 服务
 * 提供;PTY 幕布对它是黑盒(仅启动日志)。故该 profile 的会话中央区直接内嵌
 * host Web UI(iframe,origin 取连接配置),composer 由 MainPanel 一并隐藏。
 * 经 ctx.registerSessionCanvas 登记(kernel/sessionCanvas 契约)。
 */
import type { SessionCanvasProps } from "@kernel/sessionCanvas";
import { loadConnection, originOf } from "./dshHost";

export function DshCanvas({ sessionId }: SessionCanvasProps) {
  const origin = originOf(loadConnection());
  return (
    <iframe
      key={`${sessionId}:${origin}`}
      className="dsh-canvas-frame"
      src={`${origin}/`}
      title="DSH Web UI"
    />
  );
}
