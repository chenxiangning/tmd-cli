/**
 * 键盘工具条 —— 按键经 session_write 发原始 PTY 序列(与 ask 卡允许/拒绝同一通道)。
 * 切模型 = composer 发 /model 打开 CLI TUI 后,用本条 ←→↑↓↵/esc 操作;
 * 十家 CLI 通吃,零新 RPC、零白名单扩面(spec 2026-09-23-mobile-session-compact)。
 * 软键盘弹起(composer 聚焦)时整行隐藏:键条会被键盘顶出视野,省 38px。
 */
import { writeSession } from "./remote";
import { KEYS } from "./shared";

export function KeyToolbar(props: { sessionId: string; hidden: boolean }) {
  if (props.hidden) return null;
  return (
    <div className="keybar">
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          className="key"
          aria-label={k.aria}
          onClick={() => void writeSession(props.sessionId, k.seq)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
