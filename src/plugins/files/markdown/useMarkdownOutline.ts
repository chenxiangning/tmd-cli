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
  }, [outline, revealComplete]);

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
