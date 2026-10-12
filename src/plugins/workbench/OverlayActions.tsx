/**
 * 工作台 · 顶栏右区动作(文档生成菜单 / 示例数据菜单 / 新建 / 关闭),
 * 自 WorkbenchOverlay 拆出(组件复杂度铁律)。菜单开合态归本组件;
 * 数据动作(生成示例/清空请求)经回调上抛,写盘仍在覆盖层。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { buildSampleProjects, sampleSummary } from "./sample";
import { generateSamples } from "./store";

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
  /* 点外部收菜单(academyEntry 先例);Escape 收菜单(role=menu 的键盘最低契约)。 */
  useEffect(() => {
    if (!dataMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDataMenuOpen(false);
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
  const generate = () => {
    const samples = buildSampleProjects(today);
    void generateSamples(() => samples).then(
      () => onToast(t("已生成:{summary}", { summary: sampleSummary(samples) })),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
    setDataMenuOpen(false);
  };
  return (
    <div className="wb-top-actions" ref={rootRef}>
      <button type="button" className="wb-btn" onClick={onDocGen}>{t("生成文档")}</button>
      <div className="wb-menu-anchor">
        <button type="button" className="wb-btn" aria-haspopup="menu" aria-expanded={dataMenuOpen} onClick={() => setDataMenuOpen((v) => !v)}>
          {t("示例数据")}
        </button>
        {dataMenuOpen ? (
          <div className="wb-menu" role="menu">
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
