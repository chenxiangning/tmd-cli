/**
 * 打开方式入口 + 菜单(files 插件)—— 复刻 mossx OpenAppMenu footer 分裂钮形态:
 *   [默认目标图标+名 → 直开] │ [⌄ → 菜单]
 * 菜单行点击 = 选用该目标并打开;默认项按扩展名记忆(覆盖层优先,回落全局默认,
 * 见 kernel/openWith)。弹层走 wsmenu 范式(portal + backdrop + Escape),向上弹出、
 * 右对齐锚点;菜单内 ↑↓ 移动光标、Enter 选用。打开失败弹局部 toast(仓内无全局
 * toast 体系,PluginMarketPage 同款局部态)。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import { useEscClose } from "@kernel/DialogShell";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import {
  openWithExt,
  rememberOpenWithDefault,
  resolveDefaultOpenWithFor,
} from "@kernel/openWith";
import { OpenWithIcon } from "@kernel/OpenWithIcon";
import type { OpenWithTarget } from "@kernel/settingsTypes";

export function OpenWithMenu({ path }: { path: string }) {
  const { settings } = useSettingsState();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, w: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuH, setMenuH] = useState(0);

  const targets = settings.openWithTargets;
  /* 已含扩展名记忆 → 全局默认 → 失效回落首项;null 仅清单空(入口隐藏)。 */
  const def = resolveDefaultOpenWithFor(targets, settings.openWithDefaultId, path);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  /** 打开动作:失败上 toast(不再只 console.error);成功无反馈(应用自己可见)。 */
  const openWithTarget = (target: OpenWithTarget) => {
    ipc.fsOpenWith(path, target).catch((e) => {
      showNotice(t("打开失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      console.error("[open-with] 打开失败:", e);
    });
  };

  useLayoutEffect(() => {
    if (open && menuRef.current) {
      menuRef.current.focus();
      setMenuH(menuRef.current.getBoundingClientRect().height);
    }
  }, [open, targets.length]);

  useEscClose(() => setOpen(false));

  if (!def) return null;

  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAnchor({ x: r.right, y: r.bottom, w: r.width });
    setCursor(Math.max(0, targets.findIndex((x) => x.id === def.id)));
    setOpen((v) => !v);
  };

  /** 选用目标:有扩展名按类型记忆(不覆写全局默认);无扩展名保持全局默认语义。 */
  const pick = (target: OpenWithTarget) => {
    if (openWithExt(path)) rememberOpenWithDefault(path, target.id);
    else updateSettings({ openWithDefaultId: target.id });
    openWithTarget(target);
    setOpen(false);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setCursor((c) => (c + delta + targets.length) % targets.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(targets[cursor] ?? def);
    }
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
        onClick={() => openWithTarget(def)}
        title={t("用 {label} 打开", { label: def.label })}
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
            <div
              className="ow-menu"
              role="menu"
              ref={menuRef}
              tabIndex={-1}
              aria-label={t("选择打开方式")}
              aria-activedescendant={`ow-mi-${cursor}`}
              onKeyDown={onMenuKeyDown}
              style={{ left, top, width: mw }}
            >
              {targets.map((target, i) => (
                <button
                  key={target.id}
                  id={`ow-mi-${i}`}
                  type="button"
                  role="menuitem"
                  className={`ow-menu-item${target.id === def.id ? " is-active" : ""}${
                    i === cursor ? " bg-[color-mix(in_srgb,var(--tmd-fg)_8%,transparent)]" : ""
                  }`}
                  onClick={() => pick(target)}
                  onMouseEnter={() => setCursor(i)}
                >
                  <OpenWithIcon target={target} size="1rem" />
                  <span className="ow-menu-label">{target.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
      {notice &&
        createPortal(
          <div
            role="status"
            className="pointer-events-none fixed bottom-10 right-6 z-[1202] max-w-[18rem] rounded-lg border border-(--tmd-border-strong) bg-(--tmd-bg-popover) px-3 py-1.5 text-xs text-(--tmd-fg) shadow-(--tmd-shadow-popover)"
          >
            {notice}
          </div>,
          document.body,
        )}
    </span>
  );
}
