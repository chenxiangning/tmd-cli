/**
 * 分桶抽样(纯函数,可测):锚点数超容量时均分 maxVisible 桶,每桶取中点;
 * active 落在哪个桶,该桶就强制显示 active(codemoss 同款算法)。
 * 自 AnchorRail.tsx 拆出(only-export-components:组件文件只留组件)。
 */

import type { UserMessageAnchor } from "@kernel/messageAnchors";


/** 预览卡标题字符上限(codemoss deriveAnchorPreviewCopy 同款:首行 60 字)。 */
export const PREVIEW_TITLE_CHARS = 60;
/** 预览卡描述字符上限(余行 160 字)。 */
export const PREVIEW_DESC_CHARS = 160;
/** 单条 dash 视口高度(10px 命中区 + 3px 间隙,与 composer-anchors.css gap:3px / .composer-anchor-item height:10px 对齐)。 */
export const ROW_PX = 13;
/** 跳锚未命中闪烁时长(与 CSS composer-anchor-miss 动画 1.2s 一致,JS 在动画结束移除类)。 */
export const MISS_FLASH_MS = 1200;
/** hover dash 邻近渐变半径(codemoss is-proximity-0..3 同款)。 */
export const PROXIMITY_RANGE = 3;
interface VisibleAnchor {
  anchor: UserMessageAnchor;
  /** 在完整列表里的序号(预览卡 N. 标题来源)。 */
  index: number;
}

export function sampleAnchors(
  anchors: readonly UserMessageAnchor[],
  maxVisible: number,
  activeId: string | null,
): VisibleAnchor[] {
  if (anchors.length <= maxVisible) {
    return anchors.map((anchor, index) => ({ anchor, index }));
  }
  const activeIndex = activeId ? anchors.findIndex((a) => a.id === activeId) : -1;
  return Array.from({ length: maxVisible }, (_, bucket) => {
    const start = Math.floor((bucket * anchors.length) / maxVisible);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * anchors.length) / maxVisible));
    const pick =
      activeIndex >= start && activeIndex < end ? activeIndex : Math.floor((start + end - 1) / 2);
    return { anchor: anchors[pick]!, index: pick };
  });
}
