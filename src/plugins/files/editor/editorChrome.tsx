/**
 * 文件 tab 编辑器壳组件 —— 主题明暗跟随 hook + 编辑/预览切换钮。
 * 从 FileTabContent 拆出(文件规模铁则);纯文案/着色函数在 editorChromeLogic.ts。
 */
import { useEffect, useState } from "react";
import { Eye, Pencil } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

/** 编辑器明暗跟随 <html data-theme>(custom preset 也只二分 dark/light)。 */
export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.getAttribute("data-theme") === "dark",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

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
