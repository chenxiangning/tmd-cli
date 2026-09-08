/**
 * 拖拽悬停遮罩 —— 自 Composer.tsx 拆出(文件规模铁则):
 * 对齐 composer-design.html 的 .drag-over(accent 内环 + 虚线框 + 提示)。
 * pointer-events-none 让 drop 穿透到根容器;inset 顶部留 32px 避开状态栏。
 */

import { t } from "@kernel/i18n";

export function DragOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-(--tmd-bg-elevated)/75">
      <div className="absolute inset-x-2 bottom-2 top-8 rounded-lg border-[1.5px] border-dashed border-(--tmd-accent)" />
      <span className="relative text-xs text-(--tmd-accent)">{t("释放以附加文件 / 图片")}</span>
    </div>
  );
}
