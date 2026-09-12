/**
 * Mermaid 代码块 —— 照抄 codemoss FileMarkdownMermaidBlock。
 *
 * Source/Render 双 tab(会话内缓存选择);主题跟随 documentElement data-theme;
 * 全屏经 FullscreenViewer(viewerjs)。
 * 渲染管线与缓存(懒 import mermaid / SVG LRU / 主题探测)见 useMermaidRender.ts。
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CornersOut } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { hashStableString } from "./markdownDocument";
import { highlightLine } from "./syntax";
import { FullscreenViewer } from "./FullscreenViewer";
import { resolveMermaidViewerSrc } from "./viewerSrcModel";
import { preloadViewerjs } from "./viewerRuntime";
import {
  detectMermaidTheme,
  readCachedMermaidRender,
  readCachedMermaidTabs,
  useMermaidRenderState,
  writeCachedMermaidTab,
  type MermaidBlockTab,
} from "./useMermaidRender";

export const FileMarkdownMermaidBlock = memo(function FileMarkdownMermaidBlock({
  blockKey,
  className,
  documentKey,
  value,
}: {
  blockKey: string;
  className?: string;
  documentKey: string;
  value: string;
}) {
  const [, setThemeVersion] = useState(0);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MermaidBlockTab>(
    () => readCachedMermaidTabs(documentKey)[blockKey] ?? "source",
  );
  const mermaidTheme = detectMermaidTheme();
  const contentKey = `${documentKey}:${blockKey}:${hashStableString(value)}`;
  const renderCacheKey = `${contentKey}:${mermaidTheme}`;
  const { renderState, lastSuccessfulSvgRef } = useMermaidRenderState({
    activeTab,
    mermaidTheme,
    renderCacheKey,
    value,
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [stableBodyMinHeight, setStableBodyMinHeight] = useState(0);
  const highlightedHtml = useMemo(() => highlightLine(value, "mermaid"), [value]);
  const cachedSvgForActiveRender =
    activeTab === "render" ? readCachedMermaidRender(renderCacheKey) : null;
  const visibleSvg =
    renderState.status === "success"
      ? renderState.svg
      : cachedSvgForActiveRender ?? lastSuccessfulSvgRef.current;

  /* 换文档/换块/内容变化:渲染期 prev-key 对比直接复位 tab 与占位高度
     (原 effect 复位会在两次提交间闪一帧旧 tab;key 覆盖三要素且与缓存键同源)。 */
  const [prevIdentityKey, setPrevIdentityKey] = useState(contentKey);
  if (prevIdentityKey !== contentKey) {
    setPrevIdentityKey(contentKey);
    setActiveTab(readCachedMermaidTabs(documentKey)[blockKey] ?? "source");
    setStableBodyMinHeight(0);
  }

  const handleActiveTabChange = useCallback((nextActiveTab: MermaidBlockTab) => {
    writeCachedMermaidTab(documentKey, blockKey, nextActiveTab);
    setActiveTab((currentTab) =>
      currentTab === nextActiveTab ? currentTab : nextActiveTab,
    );
  }, [blockKey, documentKey]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.attributeName === "data-theme" ||
          mutation.attributeName === "data-theme-preset"
        ) {
          setThemeVersion((prev) => prev + 1);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    const recordBodyHeight = () => {
      const nextHeight = Math.ceil(body.getBoundingClientRect().height);
      if (nextHeight <= 0) {
        return;
      }
      setStableBodyMinHeight((currentHeight) =>
        nextHeight > currentHeight ? nextHeight : currentHeight,
      );
    };

    recordBodyHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(recordBodyHeight);
    observer.observe(body);
    return () => observer.disconnect();
  }, [activeTab, highlightedHtml, renderState, visibleSvg]);

  // SVG 就绪即预热 viewerjs,首个全屏点击不付 dynamic-import 延迟。
  useEffect(() => {
    if (visibleSvg) {
      void preloadViewerjs();
    }
  }, [visibleSvg]);

  return (
    <div className="fvp-file-markdown-codeblock fvp-file-markdown-mermaid">
      <MermaidTabBar
        activeTab={activeTab}
        canFullscreen={activeTab === "render" && !!visibleSvg}
        onTab={handleActiveTabChange}
        onFullscreen={() => setIsFullscreenOpen(true)}
      />
      <div
        ref={bodyRef}
        className="fvp-file-markdown-mermaid-body"
        data-active-tab={activeTab}
        style={stableBodyMinHeight > 0 ? { minHeight: stableBodyMinHeight } : undefined}
      >
        {activeTab === "source" ? (
          <pre>
            <code
              className={className}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        ) : visibleSvg ? (
          <div
            className="fvp-file-markdown-mermaid-diagram"
            data-testid="file-markdown-mermaid-preview"
            dangerouslySetInnerHTML={{ __html: visibleSvg }}
          />
        ) : renderState.status === "error" ? (
          <div className="fvp-file-markdown-mermaid-status fvp-file-markdown-mermaid-error">
            {t("渲染失败:{message}", { message: renderState.message })}
          </div>
        ) : (
          <div className="fvp-file-markdown-mermaid-status">{t("渲染中…")}</div>
        )}
      </div>

      <FullscreenViewer
        open={isFullscreenOpen}
        src={visibleSvg ?? ""}
        onClose={() => setIsFullscreenOpen(false)}
        resolveSrc={resolveMermaidViewerSrc}
        navigation={false}
      />
    </div>
  );
});

/** Mermaid 块头:标签 + 源码/渲染 tab + 全屏钮(自主体拆出降分支)。 */
function MermaidTabBar({
  activeTab,
  canFullscreen,
  onTab,
  onFullscreen,
}: {
  activeTab: MermaidBlockTab;
  canFullscreen: boolean;
  onTab: (tab: MermaidBlockTab) => void;
  onFullscreen: () => void;
}) {
  return (
    <div className="fvp-file-markdown-codeblock-label">
      <span>Mermaid</span>
      <div className="fvp-file-markdown-mermaid-tabs" role="tablist" aria-label={t("Mermaid 预览方式")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "source"}
          className={`fvp-file-markdown-mermaid-tab${activeTab === "source" ? " is-active" : ""}`}
          onClick={() => onTab("source")}
        >
          {t("源码")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "render"}
          className={`fvp-file-markdown-mermaid-tab${activeTab === "render" ? " is-active" : ""}`}
          onClick={() => onTab("render")}
        >
          {t("渲染")}
        </button>
        <button
          type="button"
          className="fvp-file-markdown-mermaid-fullscreen"
          onClick={onFullscreen}
          disabled={!canFullscreen}
          aria-label={t("全屏查看")}
          title={t("全屏查看")}
        >
          <CornersOut size="0.875rem" aria-hidden />
        </button>
      </div>
    </div>
  );
}
