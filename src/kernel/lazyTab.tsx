/**
 * tab/面板组件懒加载壳 —— 重插件的注册组件改按需加载,首包不背。
 *
 * 用法:插件注册面把静态组件换成
 *   registerTabContent({ kind, component: lazyTab(() => import("./XTab")), icon });
 * loader 返回 { default: 组件 };插件 meta/图标/侧栏动作保持静态注册,
 * 首次渲染才拉取 chunk,Suspense 兜底轻量占位(kernel 不感知具体插件)。
 */

import { createElement, lazy, Suspense, type ComponentType } from "react";
import { t } from "./i18n";

/** 任意 props 形状的组件懒加载(Suspense 内嵌,调用方零改动)。 */
export function lazySuspense<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  /* lazy 的返回类型对泛型 P 不友好,按 ComponentType<P> 收敛;运行时即 lazy 组件。 */
  const Inner = lazy(load) as unknown as ComponentType<P>;
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
