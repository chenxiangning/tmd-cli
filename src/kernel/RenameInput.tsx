/**
 * 行内重命名输入 —— 会话重命名的共享 UI 契约(kernel 层)。
 *
 * 原生于 plugins/workspace/SessionRows;会话 tab 条(app-shell/SessionTabBar)
 * 右键菜单也要行内重命名,跨层共享契约按架构铁律沉淀进 kernel。
 * 行为:Enter/blur 提交,Escape 取消;空值 = 清除手动命名(回归磁盘原生标题)。
 * settled 闸:提交/取消后卸载触发的二次 blur 不得重复回调。
 */
import { useRef, useState } from "react";

/** 行内重命名目标:以 CLI 磁盘身份为 key(与覆盖层同 key)。 */
export interface RenameTarget {
  profileId: string;
  cliSessionId: string;
  current: string;
}

export function RenameInput({
  target,
  className = "thread-rename-input",
  onCommit,
}: {
  target: RenameTarget;
  /** 样式钩子:侧栏行 thread-rename-input(默认);会话 tab 传 session-tab-rename-input。 */
  className?: string;
  /** value=null 为取消;否则为最终输入(可能为空串 = 清除命名)。 */
  onCommit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(target.current);
  const settled = useRef(false);
  const finish = (result: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onCommit(result);
  };
  return (
    <input
      className={className}
      autoFocus
      value={value}
      placeholder="会话名称(留空清除命名)"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}
