/**
 * 键盘工具条 —— 按键经 session_write 发原始 PTY 序列(与 ask 卡允许/拒绝同一通道)。
 * 切模型 = composer 发 /model 打开 CLI TUI 后,用本条 ←→↑↓↵/esc 操作;
 * 十家 CLI 通吃,零新 RPC、零白名单扩面(spec 2026-09-23-mobile-session-compact)。
 * 两行大键网格(spec 2026-10-03-mobile-keybar-relayout):行1 导航五键/行2 功能
 * 六键,全宽平铺不滚动,键高 ≥44px(治 11px 小键触达难)。
 * 软键盘弹起(composer 聚焦)时整行隐藏:两行 ~100px 会被键盘顶出视野更远。
 */
import { writeSession } from "./remote";
import { KEY_ROWS } from "./shared";

export function KeyToolbar(props: { sessionId: string; hidden: boolean }) {
  if (props.hidden) return null;
  return (
    <div className="keybar">
      {KEY_ROWS.map((row, i) => (
        <div className={"keyrow " + (i === 0 ? "nav" : "fn")} key={row[0].label}>
          {row.map((k) => (
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
      ))}
    </div>
  );
}
