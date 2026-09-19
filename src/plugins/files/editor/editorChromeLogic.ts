/**
 * 文件 tab 编辑器壳纯逻辑 —— 自 editorChrome.tsx 拆出(react-doctor 非组件
 * 导出规则:组件文件只导出组件与 hook)。
 */
import { t } from "@kernel/i18n";

/** 工具条状态文案:远程只读 > 错误 > 保存中 > 脏 > 已保存。 */
export function statusText(
  doc: { error: string | null; saving: boolean; dirty: boolean },
  remote: boolean,
): string {
  if (remote) return t("远程文件 · 只读(M1)");
  if (doc.error) return doc.error;
  if (doc.saving) return t("保存中…");
  if (doc.dirty) return t("● 未保存的更改 · ⌘S 保存");
  return t("已保存");
}

/** 工具条错误/脏标记着色(两者并存时同挂,视觉权重由 CSS 顺序承担)。 */
export function toolbarCls(error: string | null, dirty: boolean): string {
  const flags = [error ? "is-error" : "", dirty ? "is-dirty" : ""].filter(Boolean).join(" ");
  return `file-editor-toolbar${flags ? ` ${flags}` : ""}`;
}
