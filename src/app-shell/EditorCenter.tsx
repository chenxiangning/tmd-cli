/**
 * 编辑区(文件预览面板)── 内容挂载点。
 * 2026-09-06 架构改:tab 条上移顶栏(EditorTabStrip,经 contributions 挂
 * header.breadcrumb),本组件只按激活 tab 渲染内容,不再自带表头第二排。
 */

import { memo } from "react";
import { getTabContent, isKeepAliveTab, useEditorTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";

export const EditorCenter = memo(function EditorCenter() {
  const { tabs, activeId } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId) ?? null;
  /* 内容按 tab.kind 路由(kernel/tabs 注册表):插座裁决渲染权,
     外壳不认识任何 tab 内容组件。未注册 kind 的兜底空态与无 tab 一致。 */
  const Content = active ? getTabContent(active.kind) : undefined;
  /* 保活 tab(keepAlive 注册):同一树位常驻渲染,可见性经 display:none 切换
     ——树位不换,React 不卸载,组件态与长生命周期资源(RPC 子进程)跨切换
     存活;tab 关闭(移出 tabs)才走真卸载清理。非保活 tab 维持原样:按激活
     tab 挂载,key=tab.id,切换即卸载重挂。 */
  const kept = tabs.filter((tb) => isKeepAliveTab(tb.kind));

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div className="min-h-0 flex-1 overflow-auto">
        {kept.map((tb) => {
          const Kept = getTabContent(tb.kind);
          if (!Kept) return null;
          const isActive = tb.id === activeId;
          return (
            <div key={tb.id} className={isActive ? "h-full" : "hidden"} aria-hidden={!isActive}>
              <Kept tab={tb} />
            </div>
          );
        })}
        {active && Content && !isKeepAliveTab(active.kind) ? (
          <Content key={active.id} tab={active} />
        ) : active && isKeepAliveTab(active.kind) ? null : (
          <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
            {t("选中一个文件查看")}
          </div>
        )}
      </div>
    </div>
  );
});
