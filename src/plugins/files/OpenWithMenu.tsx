/**
 * 打开方式入口 + 菜单(files 插件)—— 复刻 mossx OpenAppMenu footer 分裂钮形态:
 *   [默认目标图标+名 → 直开] │ [⌄ → 菜单]
 * 菜单行点击 = 选用该目标并打开(mossx handleSelectOpenTarget 同语义);默认项 is-active 高亮。
 * 弹层走 wsmenu 范式(portal + backdrop + Escape),向上弹出、右对齐锚点。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { resolveDefaultOpenWith } from "@kernel/openWith";
import { OpenWithIcon } from "@kernel/OpenWithIcon";
import type { OpenWithTarget } from "@kernel/settingsTypes";

/** 打开动作:失败弹系统提示(错误横幅之类属宿主,这里最小 = console + 菜单即关)。 */
function openWithTarget(path: string, target: OpenWithTarget): void {
  ipc.fsOpenWith(path, target).catch((e) => console.error("[open-with] 打开失败:", e));
}

export function OpenWithMenu({ path }: { path: string }) {
  const { settings } = useSettingsState();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, w: 0 });
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuH, setMenuH] = useState(0);

  const targets = settings.openWithTargets;
  const fallback = resolveDefaultOpenWith(targets, settings.openWithDefaultId);
  const def = fallback ?? targets[0] ?? null;

  useLayoutEffect(() => {
    if (open && menuRef.current) setMenuH(menuRef.current.getBoundingClientRect().height);
  }, [open, targets.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!def) return null;

  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAnchor({ x: r.right, y: r.bottom, w: r.width });
    setOpen((v) => !v);
  };

  const pick = (target: OpenWithTarget) => {
    updateSettings({ openWithDefaultId: target.id });
    openWithTarget(path, target);
    setOpen(false);
  };

  /* 右对齐:菜单右边贴锚点右边;向上弹(footer 场景),视口夹取。 */
  const mw = 200;
  const left = Math.min(Math.max(8, anchor.x - mw), window.innerWidth - mw - 8);
  const top = Math.max(8, anchor.y - menuH - 6);

  return (
    <span className="ow-split" ref={wrapRef}>
      <button
        type="button"
        className="ow-split-action"
        onClick={() => openWithTarget(path, def)}
        title={`${t("用")} ${def.label} ${t("打开")}`}
      >
        <OpenWithIcon target={def} size="0.75rem" />
        <span className="ow-split-label">{def.label}</span>
      </button>
      <button
        type="button"
        className="ow-split-toggle"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("选择打开方式")}
      >
        <CaretDown size="0.875rem" aria-hidden />
      </button>
      {open &&
        createPortal(
          <>
            <div className="ow-backdrop" role="presentation" onClick={() => setOpen(false)} />
            <div className="ow-menu" role="menu" ref={menuRef} style={{ left, top, width: mw }}>
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className={`ow-menu-item${target.id === def.id ? " is-active" : ""}`}
                  onClick={() => pick(target)}
                >
                  <OpenWithIcon target={target} size="1rem" />
                  <span className="ow-menu-label">{target.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </span>
  );
}
