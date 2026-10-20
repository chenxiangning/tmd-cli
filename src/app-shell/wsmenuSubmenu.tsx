/**
 * wsmenu 行原语(app-shell 本地版;范式同 plugins/files/FileDetailGitSubmenu,
 * 但 app-shell 不依赖插件模块,按 TabContextMenu 先例本地实现)。
 * MenuRow:单行菜单项,点击即执行并关菜单。SubmenuRow:hover 展开的二级子菜单行;
 * fixed 定位逃逸 .wsmenu overflow 剪裁,右侧放不下翻左;
 * 飞层是 host 的 DOM 子节点,移入飞层不触发 host mouseleave。
 */
import { type ReactNode, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";

export function MenuRow({
  icon,
  label,
  disabled,
  hint,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  hint?: string;
  onPick: () => void;
}) {
  return (
    <button
      className="wsmenu-item"
      disabled={disabled}
      title={hint}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
}

export function SubmenuRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const open = () => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 176;
    const x = r.right + W + 8 > window.innerWidth ? r.left - W + 4 : r.right - 4;
    setPos({ x, y: Math.max(8, Math.min(r.top - 6, window.innerHeight - 190)) });
  };
  return (
    <div
      ref={hostRef}
      className="wsmenu-submenu-host"
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
    >
      <button type="button" className="wsmenu-item">
        <span className="wsmenu-item-icon">{icon}</span>
        <span className="wsmenu-item-label">{label}</span>
        <span className="wsmenu-item-kbd">
          <CaretRight size="0.8125rem" />
        </span>
      </button>
      {pos && (
        <div className="wsmenu-submenu" role="menu" style={{ left: pos.x, top: pos.y }}>
          {children}
        </div>
      )}
    </div>
  );
}
