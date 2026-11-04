/**
 * 设置面板壳 —— 全屏 overlay:返回应用 + 左导航(一级组 → 原 section)+ 右侧 tab 内容。
 *
 * 数据全部来自 kernel 注册表(kernel/settingsRegistry):
 * 未注册 = 不渲染。本组件不含任何具体设置项,具体 tab 由插件注册。
 * F-03 归组:组可折叠(默认展开),深链目标所属组自动展开;
 * section/tab id 与深链契约零改动。
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react";
import {
  closeSettingsPanel,
  useSettingsState,
} from "@kernel/settings";
import { t } from "@kernel/i18n";
import { SETTINGS_NAV_GROUPS, useSettingsSections } from "@kernel/settingsRegistry";
import { groupSettingsSections } from "./navGroups";

export function SettingsPanel() {
  const { panelOpen, panelTarget } = useSettingsState();
  const sections = useSettingsSections();
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  /* 折叠的组 id(F-03);默认全展开,深链自动展开目标组。 */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  /* 深链:openSettingsPanel({section,tab}) 驱动跳转(远程控制徽标等入口);
     目标 section 所属组同步展开(组折叠态不挡深链)。 */
  useEffect(() => {
    if (!panelTarget) return;
    setActiveSectionId(panelTarget.section);
    setActiveTabId(panelTarget.tab ?? null);
    const target = sections.find((s) => s.id === panelTarget.section);
    const groupId = SETTINGS_NAV_GROUPS.find((g) => g.id === target?.navGroup)?.id;
    if (groupId) {
      setCollapsedGroups((prev) => {
        if (!prev.has(groupId)) return prev;
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  }, [panelTarget, sections]);

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

  const navEntries = useMemo(
    () => groupSettingsSections(sections, SETTINGS_NAV_GROUPS),
    [sections],
  );

  if (!panelOpen) return null;

  const ActiveTabComponent = activeTab?.component ?? null;

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const sectionButton = (section: (typeof sections)[number]) => (
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
  );

  return (
    <dialog open className="settings-panel w-full h-full m-0 p-0 border-0 bg-transparent" aria-label={t("设置")} data-icon-decor="settings">
      <nav className="settings-nav">
        <button type="button" className="settings-back" onClick={closeSettingsPanel}>
          <ArrowLeft size="0.875rem" aria-hidden />
          {t("返回应用")}
        </button>
        {navEntries.map((entry) =>
          entry.group ? (
            <div key={entry.group.id} className="settings-nav-group-wrap">
              <button
                type="button"
                className="settings-nav-group"
                aria-expanded={!collapsedGroups.has(entry.group.id)}
                onClick={() => toggleGroup(entry.group!.id)}
              >
                <CaretRight size="0.625rem" aria-hidden />
                {t(entry.group.label)}
              </button>
              {!collapsedGroups.has(entry.group.id) && (
                <div className="settings-nav-group-items">{entry.sections.map(sectionButton)}</div>
              )}
            </div>
          ) : (
            <div key="(ungrouped)" className="settings-nav-group-items settings-nav-flat">{entry.sections.map(sectionButton)}</div>
          ),
        )}
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
