/**
 * Empty —— 全仓统一空态形制(2026-10-02 设计系统收口):
 * 图标 + 一句话 + 可选动作,列居中排(gap 8px,内距 24px/12px)。
 * 形制规范:
 * - icon 由调用方传 Phosphor 字形,组件内包一层 1.25rem fg-faint 容器;
 * - 文案一句话,text-xs fg-faint(空态是弱化陈述,不做多段排版);
 * - action 至多一枚次级钮(边框钮形),空态不给主按钮;
 * - 错误态不进此形制(错误走 role=alert / err 色系,另有形制)。
 */
import type { ReactNode } from "react";

export function Empty({
  icon,
  children,
  action,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
      {icon && (
        <span className="flex h-5 w-5 items-center justify-center text-(--tmd-fg-faint) [&_svg]:size-full">
          {icon}
        </span>
      )}
      <span className="text-xs text-(--tmd-fg-faint)">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded border border-(--tmd-border) px-3 py-1 text-xs hover:bg-(--tmd-bg-hover)"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
