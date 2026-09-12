/**
 * 设置面板壳 —— 全屏 overlay:返回应用 + 左导航(section) + 右侧 tab 内容。
 *
 * 数据全部来自 kernel 注册表(kernel/settingsRegistry):
 * 未注册 = 不渲染。本组件不含任何具体设置项,具体 tab 由插件注册。
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import {
  closeSettingsPanel,
  useSettingsState,
} from "@kernel/settings";
import { t } from "@kernel/i18n";
import { useSettingsSections } from "@kernel/settingsRegistry";

export function SettingsPanel() {
  const { panelOpen } = useSettingsState();
  const sections = useSettingsSections();
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  /* Esc 关闭(面板是全屏 overlay,不抢编辑器输入,只在打开时挂监听)。 */
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettingsPanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  const activeSection = useMemo(() => {
    const fallback = sections[0] ?? null;
    return sections.find((s) => s.id === activeSectionId) ?? fallback;
  }, [sections, activeSectionId]);
  const activeTab = useMemo(() => {
    if (!activeSection || activeSection.tabs.length === 0) return null;
    return (
      activeSection.tabs.find((t) => t.id === activeTabId) ?? activeSection.tabs[0]
    );
  }, [activeSection, activeTabId]);

  if (!panelOpen) return null;

  const ActiveTabComponent = activeTab?.component ?? null;

  return (
    <dialog open className="settings-panel w-full h-full m-0 p-0 border-0 bg-transparent" aria-label={t("设置")}>
      <nav className="settings-nav">
        <button type="button" className="settings-back" onClick={closeSettingsPanel}>
          <ArrowLeft size="0.875rem" aria-hidden />
          {t("返回应用")}
        </button>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`settings-nav-item${section.id === activeSection?.id ? " is-active" : ""}`}
            onClick={() => {
              setActiveSectionId(section.id);
              setActiveTabId(null); /* 切 section 回到其首个 tab */
            }}
          >
            {section.icon}
            {t(section.title)}
          </button>
        ))}
      </nav>

      <main className="settings-main">
        {activeSection && (
          <div className="settings-content">
            <h1 className="settings-title">{t(activeSection.title)}</h1>
            {activeSection.description && (
              <p className="settings-subtitle">{t(activeSection.description)}</p>
            )}

            {/* 单 tab section 不渲染 tab 条:孤零零一个 tab 配通栏下划线观感差,内容直接平铺。 */}
            {activeSection.tabs.length > 1 && (
              <div className="settings-tabs" role="tablist">
                {activeSection.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTab?.id}
                    className={`settings-tab${tab.id === activeTab?.id ? " is-active" : ""}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {tab.icon}
                    {t(tab.title)}
                  </button>
                ))}
              </div>
            )}

            {ActiveTabComponent && <ActiveTabComponent />}
          </div>
        )}
      </main>
    </dialog>
  );
}
