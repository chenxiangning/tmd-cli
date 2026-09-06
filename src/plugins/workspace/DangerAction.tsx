/**
 * 两步武装按钮(管理模式专用,自 SessionManage 拆出守 300 行铁则):
 * 首击仅进入确认态(3s 自动解除),再击执行。与 SessionContextMenu 删除的
 * 两步确认同语义,防误删物理文件。
 */

import { useEffect, useState } from "react";

export function DangerAction({
  className,
  title,
  armedTitle,
  children,
  armedChildren,
  disabled,
  onConfirm,
}: {
  className: string;
  title: string;
  /** 确认态的 title/内容(行内按钮变文字「确认」,批量条变「确认删除?」)。 */
  armedTitle: string;
  children: React.ReactNode;
  armedChildren: React.ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3_000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? " is-armed" : ""}`}
      disabled={disabled}
      title={armed ? armedTitle : title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? armedChildren : children}
    </button>
  );
}
