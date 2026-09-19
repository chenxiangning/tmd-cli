/**
 * 打开方式入口 + 弹出菜单(files 插件;文件底部矮工具条最右,复刻 mossx OpenAppMenu)。
 * 行点击 = 用该应用打开当前文件(fsOpenWith);右侧圆圈 = 设默认项(仅写 settings,不触发打开)。
 * 清单 = settings.openWithTargets(数组序即菜单序,空清单入口隐藏);
 * 弹层走 wsmenu 范式(portal + fixed + backdrop + Escape,z 1200 层),
 * 以入口按钮为锚向上弹、视口内夹取。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { resolveDefaultOpenWith } from "@kernel/openWith";
import { OpenWithIcon } from "@kernel/OpenWithIcon";
import type { OpenWithTarget } from "@kernel/settingsTypes";

/** 菜单宽度估值(视口夹取,同 wsmenu 纪律)。 */
const MENU_W = 240;
/** 单行估高(向上弹落点夹取)。 */
const ROW_H = 33;

export function OpenWithMenu({ path }: { path: string }) {
  const { settings } = useSettingsState();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const targets = settings.openWithTargets;
  if (targets.length === 0) return null;
  const defaultId = resolveDefaultOpenWith(targets, settings.openWithDefaultId)?.id ?? "";

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: Math.min(Math.max(8, rect.right - MENU_W), window.innerWidth - MENU_W - 12),
      y: Math.max(8, rect.top - 6 - targets.length * ROW_H - 8),
    });
    setOpen(true);
  };

  const launch = (target: OpenWithTarget) => {
    setOpen(false);
    ipc.fsOpenWith(path, target).catch((e) => {
      console.error("[open-with]", e);
    });
  };

  return (
    <>
      {/* 入口钮必须内联在工具条右簇(flex 子元素);只有弹层 portal 到 body */}
      <button
        ref={btnRef}
        type="button"
        className="ow-entry"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t("打开方式")}
      </button>
      {open &&
        createPortal(
          <>
            <div className="ow-backdrop" role="presentation" onClick={() => setOpen(false)} />
            <div className="ow-menu" style={{ left: pos.x, top: pos.y }} role="menu">
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className="ow-menu-item"
                  onClick={() => launch(target)}
                >
                  <OpenWithIcon target={target} />
                  <span className="ow-menu-label">{target.label}</span>
                  {/* 原生 radio:圆圈点击仅设默认,不触发行打开;键盘可达性免费拿 */}
                  <input
                    type="radio"
                    name="ow-default"
                    checked={target.id === defaultId}
                    aria-label={t("设为默认")}
                    title={t("设为默认")}
                    className="ow-menu-radio"
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => updateSettings({ openWithDefaultId: target.id })}
                  />
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
