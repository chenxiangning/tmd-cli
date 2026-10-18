/**
 * tab/面板组件懒加载壳 —— 重插件的注册组件改按需加载,首包不背。
 *
 * 用法:插件注册面把静态组件换成
 *   registerTabContent({ kind, component: lazySuspense(() => import("./XTab").then((m) => ({ default: m.XTab }))), icon });
 * loader 返回 { default: 组件 };插件 meta/图标/侧栏动作保持静态注册,
 * 首次渲染才拉取 chunk,Suspense 兜底轻量占位(kernel 不感知具体插件)。
 */

import { createElement, lazy, Component, Suspense, type ComponentType, type ReactNode } from "react";
import { t } from "./i18n";
import { retryImport } from "./lazyImport";

/** 懒 chunk 加载失败(终败):基础设施态失败,不计入插件熔断计数(见下)。 */
export class LazyChunkError extends Error {
  constructor(cause: unknown) {
    super("lazy chunk failed", { cause });
  }
}

/** 懒 chunk 专类错误边界:LazyChunkError 在此落地为错误条(不计 recordPluginCrash、
 *  不给无效重试钮 —— lazy 缓存 rejection 后重试必然复败,只指引 reload);其他错误
 *  原样上抛主 PluginBoundary 归因。防「点 2 次重试 → 熔断整插件」的计数失真。 */
class LazyChunkBoundary extends Component<{ children: ReactNode }, { err: unknown }> {
  override state: { err: unknown } = { err: null };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  override render() {
    const err = this.state.err;
    if (err === null) return this.props.children;
    if (!(err instanceof LazyChunkError)) throw err;
    return (
      <div aria-busy="false" className="flex h-full items-center justify-center text-xs text-(--tmd-fg-subtle)">
        {t("组件资源加载失败;请重载页面恢复")}
      </div>
    );
  }
}

/** 任意 props 形状的组件懒加载(Suspense 内嵌,调用方零改动)。
 * retryImport 护栏:dev 冷加载 504 等瞬时失败若裸交 lazy 会被永久缓存,中央区永挂占位。
 * 已知限制:重试链终败(约 87.5s)后 rejection 被 React lazy 永久缓存,PluginBoundary
 * 的「重试该贡献位」对此无效,仅整页 reload 可恢复(终败包装为 LazyChunkError,
 * 由 LazyChunkBoundary 承接,不毒化插件熔断计数)。 */
export function lazySuspense<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const guarded = async (): Promise<{ default: ComponentType<P> }> => {
    try {
      return await retryImport(load)();
    } catch (e) {
      throw new LazyChunkError(e);
    }
  };
  const Inner = lazy(guarded) as unknown as ComponentType<P>;
  return function LazySuspenseHost(props: P) {
    return createElement(
      LazyChunkBoundary,
      null,
      createElement(
        Suspense,
        {
          fallback: createElement(
            "div",
            { "aria-busy": "true", className: "flex h-full items-center justify-center text-xs text-(--tmd-fg-subtle)" },
            t("加载中…"),
          ),
        },
        createElement<P>(Inner as ComponentType<P>, props),
      ),
    );
  };
}
