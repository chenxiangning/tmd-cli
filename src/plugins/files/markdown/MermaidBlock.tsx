/**
 * Mermaid 代码块 —— 照抄 codemoss FileMarkdownMermaidBlock。
 *
 * Source/Render 双 tab(会话内缓存选择);Render 懒 import mermaid,
 * initialize{startOnLoad:false, securityLevel:"strict"},SVG LRU 缓存;
 * 主题跟随 documentElement data-theme(tmd 主题引擎同款属性);
 * 全屏经 MermaidFullscreenViewer(viewerjs)。
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
import { Maximize2 } from "lucide-react";
import { hashStableString } from "./markdownDocument";
import { normalizeMermaidSource } from "./normalizeMermaidSource";
import { highlightLine } from "./syntax";
import { MermaidFullscreenViewer } from "./MermaidFullscreenViewer";
import { preloadViewerjs } from "./viewerRuntime";

type MermaidRenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

type MermaidBlockTab = "source" | "render";

const MAX_CACHED_MERMAID_DOCUMENTS = 50;
const MAX_CACHED_MERMAID_RENDERS = 80;
const mermaidTabSessionCache = new Map<string, Record<string, MermaidBlockTab>>();
const mermaidRenderCache = new Map<string, string>();

function readCachedMermaidTabs(documentKey: string): Record<string, MermaidBlockTab> {
  return { ...(mermaidTabSessionCache.get(documentKey) ?? {}) };
}

function writeCachedMermaidTab(
  documentKey: string,
  blockKey: string,
  activeTab: MermaidBlockTab,
) {
  const nextTabs = {
    ...(mermaidTabSessionCache.get(documentKey) ?? {}),
    [blockKey]: activeTab,
  };
  mermaidTabSessionCache.delete(documentKey);
  mermaidTabSessionCache.set(documentKey, nextTabs);
  while (mermaidTabSessionCache.size > MAX_CACHED_MERMAID_DOCUMENTS) {
    const oldestDocumentKey = mermaidTabSessionCache.keys().next().value;
    if (!oldestDocumentKey) {
      break;
    }
    mermaidTabSessionCache.delete(oldestDocumentKey);
  }
}

function readCachedMermaidRender(cacheKey: string) {
  const svg = mermaidRenderCache.get(cacheKey);
  if (!svg) {
    return null;
  }
  mermaidRenderCache.delete(cacheKey);
  mermaidRenderCache.set(cacheKey, svg);
  return svg;
}

function writeCachedMermaidRender(cacheKey: string, svg: string) {
  mermaidRenderCache.delete(cacheKey);
  mermaidRenderCache.set(cacheKey, svg);
  while (mermaidRenderCache.size > MAX_CACHED_MERMAID_RENDERS) {
    const oldestKey = mermaidRenderCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    mermaidRenderCache.delete(oldestKey);
  }
}

/** tmd 主题引擎:root.dataset.theme 恒为解析后的 light/dark。 */
function detectMermaidTheme(): "dark" | "default" {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.dataset.theme === "light" ? "default" : "dark";
}

function createStableRuntimeId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

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
  const renderCacheKey = `${documentKey}:${blockKey}:${mermaidTheme}:${hashStableString(value)}`;
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "idle",
  });
  const lastSuccessfulSvgRef = useRef<string | null>(null);
  const idRef = useRef(createStableRuntimeId("file-mermaid"));
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [stableBodyMinHeight, setStableBodyMinHeight] = useState(0);
  const highlightedHtml = useMemo(() => highlightLine(value, "mermaid"), [value]);
  const cachedSvgForActiveRender =
    activeTab === "render" ? readCachedMermaidRender(renderCacheKey) : null;
  const visibleSvg =
    renderState.status === "success"
      ? renderState.svg
      : cachedSvgForActiveRender ?? lastSuccessfulSvgRef.current;

  useEffect(() => {
    setActiveTab(readCachedMermaidTabs(documentKey)[blockKey] ?? "source");
    setStableBodyMinHeight(0);
  }, [blockKey, documentKey, value]);

  const handleActiveTabChange = useCallback((nextActiveTab: MermaidBlockTab) => {
    writeCachedMermaidTab(documentKey, blockKey, nextActiveTab);
    setActiveTab((currentTab) =>
      currentTab === nextActiveTab ? currentTab : nextActiveTab,
    );
  }, [blockKey, documentKey]);

  useEffect(() => {
    if (activeTab !== "render") {
      return;
    }

    const cachedSvg = readCachedMermaidRender(renderCacheKey);
    if (cachedSvg) {
      lastSuccessfulSvgRef.current = cachedSvg;
      setRenderState((current) =>
        current.status === "success" && current.svg === cachedSvg
          ? current
          : { status: "success", svg: cachedSvg },
      );
      return;
    }

    let cancelled = false;
    const previousSvg = lastSuccessfulSvgRef.current;
    if (!previousSvg) {
      setRenderState({ status: "rendering" });
    }

    void (async () => {
      try {
        // 有意 dynamic import:mermaid ~600KB,只在用户首次切到 Render 时加载(照抄 codemoss 的按需策略)
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme,
          securityLevel: "strict",
          fontFamily:
            "ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif",
        });

        const id = `${idRef.current}-${hashStableString(renderCacheKey)}`;
        // 渲染前给不安全的 flowchart 标签补引号;Source tab 保持原文。
        const renderSource = normalizeMermaidSource(value);
        const { svg } = await mermaid.render(id, renderSource);
        if (!cancelled) {
          writeCachedMermaidRender(renderCacheKey, svg);
          lastSuccessfulSvgRef.current = svg;
          setRenderState({ status: "success", svg });
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, mermaidTheme, renderCacheKey, value]);

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
      <div className="fvp-file-markdown-codeblock-label">
        <span>Mermaid</span>
        <div
          className="fvp-file-markdown-mermaid-tabs"
          role="tablist"
          aria-label="Mermaid 预览方式"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "source"}
            className={`fvp-file-markdown-mermaid-tab${activeTab === "source" ? " is-active" : ""}`}
            onClick={() => handleActiveTabChange("source")}
          >
            源码
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "render"}
            className={`fvp-file-markdown-mermaid-tab${activeTab === "render" ? " is-active" : ""}`}
            onClick={() => handleActiveTabChange("render")}
          >
            渲染
          </button>
          <button
            type="button"
            className="fvp-file-markdown-mermaid-fullscreen"
            onClick={() => setIsFullscreenOpen(true)}
            disabled={activeTab !== "render" || !visibleSvg}
            aria-label="全屏查看"
            title="全屏查看"
          >
            <Maximize2 size={14} aria-hidden />
          </button>
        </div>
      </div>

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
            渲染失败:{renderState.message}
          </div>
        ) : (
          <div className="fvp-file-markdown-mermaid-status">渲染中…</div>
        )}
      </div>

      <MermaidFullscreenViewer
        open={isFullscreenOpen}
        svg={visibleSvg ?? ""}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </div>
  );
});
