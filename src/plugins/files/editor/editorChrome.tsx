/**
 * 文件 tab 编辑器壳组件 —— 编辑/预览切换钮。
 * (明暗跟随钩子收口在 kernel/theme 的 useDarkTheme;纯文案/着色函数在
 * editorChromeLogic.ts。)
 */
import { Eye, Pencil } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

/** 编辑/预览切换钮(单钮两态,md 与结构化文件共用;偏好随路径持久由调用方落)。 */
export function ModeToggleButton({
  editor,
  onToggle,
}: {
  editor: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="file-mode-toggle"
      title={editor ? t("预览") : t("编辑")}
      onClick={() => onToggle(!editor)}
    >
      {editor ? <Eye size="0.75rem" aria-hidden /> : <Pencil size="0.75rem" aria-hidden />}
      {editor ? t("预览") : t("编辑")}
    </button>
  );
}
