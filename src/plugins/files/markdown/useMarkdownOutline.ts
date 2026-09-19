/**
 * 章节大纲浮窗状态机 —— 照抄 codemoss FileMarkdownPreviewRouter 的大纲逻辑。
 *
 * - outline:从编译后正文提取标题树
 * - 换文档复位(折叠 + 不钉住)
 * - 渲染后按顺序给标题挂锚点 id
 * - 点击条目:锚点滚动 + 未钉住时自动收起
 * - 鼠标离开浮窗且未钉住 → 自动收起
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractMarkdownOutline,
  flattenPreviewOutlineItems,
  type PreviewOutlineItem,
} from "./outline";

export function useMarkdownOutline({
  body,
  cacheKey,
  visibleLineLimit,
}: {
  body: string;
  cacheKey: string;
  /** 渐进渲染的可见行上限:仅用于推导 revealComplete(>= 总行数),锚点 effect 不随其逐帧重跑。 */
  visibleLineLimit: number;
}) {
  const outline = useMemo(() => extractMarkdownOutline(body), [body]);
  const totalLineCount = useMemo(
    () => (body.length === 0 ? 0 : body.split(/\r?\n/).length),
    [body],
  );
  /* 锚点挂载只关心「渐进揭示是否完成」:visibleLineLimit 渐进期每 16ms 变一次,
     若直接作 effect 依赖会反复全树 querySelectorAll。收敛成布尔后,渐进期间不跑、
     完成瞬间跑一次;渐进中点击跳转由 handleSelectOutlineItem 的序号兜底承接。 */
  const revealComplete = visibleLineLimit >= totalLineCount;
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const [isOutlinePinned, setIsOutlinePinned] = useState(false);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(true);
  /* 换文档:大纲复位为折叠+不钉住(codemoss Router 同款重置)。
     渲染期 prev-cacheKey 对比直接调校,省去 effect 方案两次提交间的 stale 中间帧。 */
  const [prevCacheKey, setPrevCacheKey] = useState(cacheKey);
  if (prevCacheKey !== cacheKey) {
    setPrevCacheKey(cacheKey);
    setActiveOutlineItemId(null);
    setIsOutlinePinned(false);
    setIsOutlineCollapsed(true);
  }


  /* 渲染后按顺序给标题挂锚点 id(querySelectorAll 顺序 = 大纲扁平序)。 */
  useEffect(() => {
    const previewRoot = previewRootRef.current;
    if (!previewRoot || outline.length === 0) {
      return;
    }
    const headingNodes = Array.from(
      previewRoot.querySelectorAll<HTMLElement>(
        ".fvp-file-markdown h1,.fvp-file-markdown h2,.fvp-file-markdown h3,.fvp-file-markdown h4,.fvp-file-markdown h5,.fvp-file-markdown h6",
      ),
    );
    flattenPreviewOutlineItems(outline).forEach((item, index) => {
      const headingNode = headingNodes[index];
      if (headingNode) {
        headingNode.id = item.target.anchorId;
      }
    });
  }, [outline, revealComplete]);

  /* yn 滚动跟随:激活项 = 视口顶沿之上最后一个标题(被动监听,行量级无需节流)。 */
  useEffect(() => {
    const scrollEl = previewRootRef.current;
    if (!scrollEl || outline.length === 0) {
      return;
    }
    const flattenItems = flattenPreviewOutlineItems(outline);
    const syncActiveFromScroll = () => {
      const headingNodes = scrollEl.querySelectorAll<HTMLElement>(
        ".fvp-file-markdown h1,.fvp-file-markdown h2,.fvp-file-markdown h3,.fvp-file-markdown h4,.fvp-file-markdown h5,.fvp-file-markdown h6",
      );
      const viewTop = scrollEl.getBoundingClientRect().top + 1;
      let active: PreviewOutlineItem | null = null;
      for (let index = 0; index < flattenItems.length; index++) {
        const headingNode = headingNodes[index];
        if (headingNode && headingNode.getBoundingClientRect().top <= viewTop) {
          active = flattenItems[index];
        }
      }
      setActiveOutlineItemId((active ?? flattenItems[0] ?? null)?.id ?? null);
    };
    syncActiveFromScroll();
    scrollEl.addEventListener("scroll", syncActiveFromScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", syncActiveFromScroll);
  }, [outline, revealComplete]);

  /* yn scrollIntoViewIfNeeded:激活行滚入大纲列表可视区(nearest,不惊动正文)。 */
  useEffect(() => {
    if (!activeOutlineItemId) {
      return;
    }
    document
      .querySelector(".fvp-preview-outline-button.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOutlineItemId]);

  const handleSelectOutlineItem = useCallback((item: PreviewOutlineItem) => {
    const articleNode = previewRootRef.current?.querySelector(".fvp-file-markdown");
    if (!articleNode) {
      return;
    }
    let anchorNode: HTMLElement | null = null;
    const documentAnchorNode = articleNode.ownerDocument.getElementById(item.target.anchorId);
    if (documentAnchorNode instanceof HTMLElement && articleNode.contains(documentAnchorNode)) {
      anchorNode = documentAnchorNode;
    }
    if (!anchorNode) {
      /* 渐进渲染下目标标题可能尚未挂载:按序号兜底取标题节点。 */
      const outlineIndex = flattenPreviewOutlineItems(outline).findIndex(
        (outlineItem) => outlineItem.id === item.id,
      );
      const headingNode = articleNode.querySelectorAll<HTMLElement>(
        "h1,h2,h3,h4,h5,h6",
      )[outlineIndex];
      if (headingNode) {
        headingNode.id = item.target.anchorId;
        anchorNode = headingNode;
      }
    }
    if (!anchorNode) {
      return;
    }
    setActiveOutlineItemId(item.id);
    anchorNode.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!isOutlinePinned) {
      setIsOutlineCollapsed(true);
    }
  }, [isOutlinePinned, outline]);

  const handleToggleOutlinePinned = useCallback(() => {
    /* 直接读 state 算下一态(无 functional updater,自然无 impure-updater 问题;
       勿用 ref 镜像——换文档复位只重置 state,镜像会漂移出错误下一态)。 */
    const nextPinned = !isOutlinePinned;
    setIsOutlinePinned(nextPinned);
    if (nextPinned) setIsOutlineCollapsed(false);
  }, [isOutlinePinned]);

  const handleToggleOutlineCollapsed = useCallback(() => {
    setIsOutlineCollapsed((current) => !current);
  }, []);


  return {
    outline,
    previewRootRef,
    activeOutlineItemId,
    isOutlinePinned,
    isOutlineCollapsed,
    handleSelectOutlineItem,
    handleToggleOutlinePinned,
    handleToggleOutlineCollapsed,
  };
}
