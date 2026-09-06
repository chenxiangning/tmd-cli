/**
 * 编辑区(文件预览面板)── 内容挂载点。
 * 2026-09-06 架构改:tab 条上移顶栏(EditorTabStrip,经 contributions 挂
 * header.breadcrumb),本组件只按激活 tab 渲染内容,不再自带表头第二排。
 */

import { memo } from "react";
import { getTabContent, useEditorTabs } from "@kernel/tabs";

export const EditorCenter = memo(function EditorCenter() {
  const { tabs, activeId } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId) ?? null;
  /* 内容按 tab.kind 路由(kernel/tabs 注册表):插座裁决渲染权,
     外壳不认识任何 tab 内容组件。未注册 kind 的兜底空态与无 tab 一致。 */
  const Content = active ? getTabContent(active.kind) : undefined;

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div className="min-h-0 flex-1 overflow-auto">
        {active && Content ? (
          <Content key={active.id} tab={active} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
            选中一个文件查看
          </div>
        )}
      </div>
    </div>
  );
});
