/**
 * 工作台 · 顶栏右区动作(文档生成菜单 / 示例数据菜单 / 新建 / 关闭),
 * 自 WorkbenchOverlay 拆出(组件复杂度铁律)。菜单开合态归本组件;
 * 数据动作(生成示例/清空请求)经回调上抛,写盘仍在覆盖层。
 */

import { useEffect, useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { buildSampleProjects, sampleSummary } from "./sample";
import { generateSamples } from "./store";
import { menuNavIndex } from "./menuNav";

/** 菜单内可聚焦项(role=menuitem 的按钮);用于方向键导航与开菜单落焦。 */
function menuItems(root: HTMLElement | null): HTMLButtonElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
}

export function OverlayActions({
  today, onToast, onNewProject, onLinkWorkspaces, onRequestClear, onRequestClearSamples, onDocGen, onRefresh, refreshing,
}: {
  today: string;
  onToast: (message: string) => void;
  onNewProject: () => void;
  onLinkWorkspaces: () => void;
  onRequestClear: () => void;
  onRequestClearSamples: () => void;
  /** 生成文档 → DocGenDialog(模板×事实源×周期;原 5 类型菜单已并入弹窗模板库)。 */
  onDocGen: () => void;
  /** AI 可能直接改过数据文件:从磁盘重读同步。 */
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /* 点外部收菜单(academyEntry 先例);Escape 收菜单并交还焦点(role=menu 的
   * 键盘最低契约)。方向键/Home/End 见下方 onMenuKey(2026-10-13 补,收口
   * 上轮遗留「OverlayActions 只有 Escape」)。 */
  useEffect(() => {
    if (!dataMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* 只在焦点确在菜单/触发钮上时交还焦点 —— 全局 Escape 监听不该抢走
       * 别处输入框的焦点 */
      const held =
        menuRef.current?.contains(document.activeElement) ||
        document.activeElement === triggerRef.current;
      setDataMenuOpen(false);
      if (held) triggerRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setDataMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [dataMenuOpen]);
  /* 开菜单即把焦点落到首项:键盘用户不必先 Tab 进菜单 */
  useEffect(() => {
    if (!dataMenuOpen) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [dataMenuOpen]);
  /** 菜单内方向键导航(环绕;Enter/Space 由 button 原生激活)。 */
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = menuNavIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  };
  const generate = () => {
    const samples = buildSampleProjects(today);
    void generateSamples(() => samples).then(
      () => onToast(t("已生成:{summary}", { summary: sampleSummary(samples) })),
      (e) => onToast(errTextDisplay(e)),
    );
    setDataMenuOpen(false);
  };
  return (
    <div className="wb-top-actions" ref={rootRef}>
      <button type="button" className="wb-btn" onClick={onDocGen}>{t("生成文档")}</button>
      <div className="wb-menu-anchor">
        <button
          type="button"
          id="wb-data-menu-trigger"
          className="wb-btn"
          ref={triggerRef}
          aria-haspopup="menu"
          aria-expanded={dataMenuOpen}
          onClick={() => setDataMenuOpen((v) => !v)}
        >
          {t("示例数据")}
        </button>
        {dataMenuOpen ? (
          <div
            className="wb-menu"
            role="menu"
            ref={menuRef}
            aria-labelledby="wb-data-menu-trigger"
            onKeyDown={onMenuKey}
          >
            <button type="button" role="menuitem" className="wb-menu-item" onClick={generate}>{t("生成示例数据")}</button>
            <button type="button" role="menuitem" className="wb-menu-item" onClick={() => { onRequestClearSamples(); setDataMenuOpen(false); }}>
              {t("清理示例数据")}
            </button>
            <button type="button" role="menuitem" className="wb-menu-item" onClick={() => { onRequestClear(); setDataMenuOpen(false); }}>
              {t("清空全部…")}
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" className="wb-btn" onClick={onLinkWorkspaces}>{t("一键关联工作区")}</button>
      <button type="button" className="wb-btn" disabled={refreshing} onClick={onRefresh}>{refreshing ? t("同步中…") : t("从磁盘同步")}</button>
      <button type="button" className="wb-btn wb-btn-primary" onClick={onNewProject}>{t("新建项目")}</button>
    </div>
  );
}
