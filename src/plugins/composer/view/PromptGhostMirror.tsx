/**
 * 输入历史 ghost 补全镜像层 —— textarea 是替换元素,`::after` 伪元素不可用;
 * 用同字体/同内边距的 absolute 覆盖层:已输入文本 invisible、历史后缀弱色,
 * 视觉即「光标后的灰色续写」。纯展示不进表单值,Tab 接受归 Composer keydown。
 * 仅光标在末尾时由 Composer 渲染;textarea onScroll 直写本层 scrollTop 同步。
 */

import type { RefObject } from "react";

export function PromptGhostMirror({ mirrorRef, value, suffix }: {
  mirrorRef: RefObject<HTMLDivElement | null>;
  value: string;
  suffix: string;
}) {
  return (
    <div
      ref={mirrorRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-0 pr-10 text-sm leading-[1.58]"
    >
      <span className="invisible">{value}</span>
      <span className="text-(--tmd-fg-faint)">{suffix}</span>
    </div>
  );
}
