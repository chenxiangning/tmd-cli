/**
 * 行内重命名输入 —— 会话重命名的共享 UI 契约(kernel 层)。
 *
 * 原生于 plugins/workspace/SessionRows;会话 tab 条(app-shell/SessionTabBar)
 * 右键菜单也要行内重命名,跨层共享契约按架构铁律沉淀进 kernel。
 * 工作区别名行内设置(plugins/workspace/WorkspaceCard)亦复用:target 仅需 current。
 * 行为:Enter/blur 提交,Escape 取消;空值 = 清除手动命名(回归磁盘原生标题)。
 * settled 闸:提交/取消后卸载触发的二次 blur 不得重复回调。
 */
import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";

/** 行内重命名目标:以 CLI 磁盘身份为 key(与覆盖层同 key)。 */
export interface RenameTarget {
  profileId: string;
  cliSessionId: string;
  current: string;
}

export function RenameInput({
  target,
  className = "thread-rename-input",
  placeholder,
  onCommit,
}: {
  target: { current: string };
  /** 样式钩子:侧栏行 thread-rename-input(默认);会话 tab 传 session-tab-rename-input。 */
  className?: string;
  /** 占位文案;缺省会话语义,工作区别名传别名语义。 */
  placeholder?: string;
  /** value=null 为取消;否则为最终输入(可能为空串 = 清除命名)。 */
  onCommit: (value: string | null) => void;
}) {
  /* 非受控:defaultValue 只取挂载期 target.current,事件里经 inputRef 读最新值,
     语义与原 useState(target.current) 一致,但不复制 prop 进 state。 */
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settled = useRef(false);
  const finish = (result: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onCommit(result);
  };
  /* 挂载即聚焦(autofocus 属性是 react-doctor no-autofocus 反模式)。 */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <input
      className={className}
      ref={inputRef}
      defaultValue={target.current}
      placeholder={placeholder ?? t("会话名称(留空清除命名)")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(inputRef.current?.value ?? "");
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(inputRef.current?.value ?? "")}
    />
  );
}
