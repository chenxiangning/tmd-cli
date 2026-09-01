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
  /** 渐进渲染的可见行上限:揭示推进后需要补挂新标题的锚点。 */
  visibleLineLimit: number;
}) {
  const outline = useMemo(() => extractMarkdownOutline(body), [body]);
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const [isOutlinePinned, setIsOutlinePinned] = useState(false);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(true);

  /* 换文档:大纲复位为折叠+不钉住(codemoss Router 同款重置)。 */
  useEffect(() => {
    setActiveOutlineItemId(null);
    setIsOutlinePinned(false);
    setIsOutlineCollapsed(true);
  }, [cacheKey]);

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
  }, [outline, visibleLineLimit]);

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
    setIsOutlinePinned((current) => {
      const nextPinned = !current;
      if (nextPinned) {
        setIsOutlineCollapsed(false);
      }
      return nextPinned;
    });
  }, []);

  const handleToggleOutlineCollapsed = useCallback(() => {
    setIsOutlineCollapsed((current) => !current);
  }, []);

  const handleOutlineMouseLeave = useCallback(() => {
    if (!isOutlinePinned) {
      setIsOutlineCollapsed(true);
    }
  }, [isOutlinePinned]);

  return {
    outline,
    previewRootRef,
    activeOutlineItemId,
    isOutlinePinned,
    isOutlineCollapsed,
    handleSelectOutlineItem,
    handleToggleOutlinePinned,
    handleToggleOutlineCollapsed,
    handleOutlineMouseLeave,
  };
}
