/**
 * MermaidBlock 运行时 —— 自 MermaidBlock.tsx 拆出(文件规模铁则)。
 * tab 选择会话缓存与 SVG LRU 缓存 / 主题探测(tmd 主题引擎 root.dataset.theme)/
 * 稳定运行时 id / useMermaidRenderState(切到 Render 才懒 import mermaid ~600KB,
 * initialize{startOnLoad:false, securityLevel:"strict"},成功写缓存)。
 */

import { useEffect, useRef, useState } from "react";
import { hashStableString } from "./markdownDocument";
import { normalizeMermaidSource } from "./normalizeMermaidSource";

type MermaidRenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

export type MermaidBlockTab = "source" | "render";

const MAX_CACHED_MERMAID_DOCUMENTS = 50;
const MAX_CACHED_MERMAID_RENDERS = 80;
const mermaidTabSessionCache = new Map<string, Record<string, MermaidBlockTab>>();
const mermaidRenderCache = new Map<string, string>();

export function readCachedMermaidTabs(documentKey: string): Record<string, MermaidBlockTab> {
  return { ...(mermaidTabSessionCache.get(documentKey) ?? {}) };
}

export function writeCachedMermaidTab(
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

export function readCachedMermaidRender(cacheKey: string) {
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
export function detectMermaidTheme(): "dark" | "default" {
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

export function useMermaidRenderState({
  activeTab,
  mermaidTheme,
  renderCacheKey,
  value,
}: {
  activeTab: MermaidBlockTab;
  mermaidTheme: "dark" | "default";
  renderCacheKey: string;
  value: string;
}) {
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "idle",
  });
  const lastSuccessfulSvgRef = useRef<string | null>(null);
  const [idPrefix] = useState(() => createStableRuntimeId("file-mermaid"));

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

        const id = `${idPrefix}-${hashStableString(renderCacheKey)}`;
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
  }, [activeTab, mermaidTheme, renderCacheKey, value, idPrefix]);

  return { renderState, lastSuccessfulSvgRef };
}
