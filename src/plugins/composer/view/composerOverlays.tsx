/**
 * Composer 浮层两件 —— 自 Composer.tsx 拆出(300 行铁则 + 控复杂度)。
 * SuggestionPortal:触发器候选面板 portal(任一前置缺失 = null);
 * PreviewOverlay:图片预览遮罩(点击关闭)。
 */

import { createPortal } from "react-dom";
import type { SuggestionMatch } from "../triggers/suggest";
import { SuggestionList } from "./SuggestionList";

export function SuggestionPortal({
  matches,
  activeRange,
  boxRect,
  popupBottom,
  popupMaxHeight,
  pickIndex,
  setPickIndex,
  applyPick,
}: {
  matches: SuggestionMatch[] | null;
  activeRange: readonly [number, number] | null;
  boxRect: DOMRect | null;
  popupBottom: number;
  popupMaxHeight: number;
  pickIndex: number;
  setPickIndex: React.Dispatch<React.SetStateAction<number>>;
  applyPick: (m: SuggestionMatch) => void;
}) {
  if (!matches || !activeRange || !boxRect) return null;
  return createPortal(
    <SuggestionList
      style={{
        left: boxRect.left + 12,
        width: boxRect.width - 24,
        bottom: popupBottom,
        maxHeight: popupMaxHeight,
      }}
      matches={matches}
      pickIndex={pickIndex}
      onPick={applyPick}
      onHoverIndex={setPickIndex}
    />,
    document.body,
  );
}

export function PreviewOverlay({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <img src={src} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
    </div>
  );
}
