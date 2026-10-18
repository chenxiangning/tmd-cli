/**
 * tab/面板组件懒加载壳 —— 重插件的注册组件改按需加载,首包不背。
 *
 * 用法:插件注册面把静态组件换成
 *   registerTabContent({ kind, component: lazySuspense(() => import("./XTab").then((m) => ({ default: m.XTab }))), icon });
 * loader 返回 { default: 组件 };插件 meta/图标/侧栏动作保持静态注册,
 * 首次渲染才拉取 chunk,Suspense 兜底轻量占位(kernel 不感知具体插件)。
 */

import { createElement, lazy, Suspense, type ComponentType } from "react";
import { t } from "./i18n";
import { retryImport } from "./lazyImport";

/** 任意 props 形状的组件懒加载(Suspense 内嵌,调用方零改动)。
 * retryImport 护栏:dev 冷加载 504 等瞬时失败若裸交 lazy 会被永久缓存,中央区永挂占位。
 * 已知限制:重试链终败(约 87.5s)后 rejection 被 React lazy 永久缓存,PluginBoundary
 * 的「重试该贡献位」对此无效,仅整页 reload 可恢复(失败文案已如实写明)。 */
export function lazySuspense<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const Inner = lazy(() => retryImport(load)()) as unknown as ComponentType<P>;
  return function LazySuspenseHost(props: P) {
    return createElement(
      Suspense,
      {
        fallback: createElement(
          "div",
          { "aria-busy": "true", className: "flex h-full items-center justify-center text-xs text-(--tmd-fg-subtle)" },
          t("加载中…"),
        ),
      },
      createElement<P>(Inner as ComponentType<P>, props),
    );
  };
}
