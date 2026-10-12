/**
 * 工作台 · 文档编辑态初始口径(纯函数,无组件;自 DocEditor.tsx 挪出守
 * react-doctor only-export-components):空文档或设置默认编辑态时进编辑,
 * 否则直接进预览。
 */

import { getSettingsState } from "@kernel/settings";

export type DocEditorMode = "edit" | "preview";

export function initialDocMode(markdown: string): DocEditorMode {
  return markdown.trim().length === 0 || getSettingsState().settings.workbenchDocDefaultMode === "edit" ? "edit" : "preview";
}
