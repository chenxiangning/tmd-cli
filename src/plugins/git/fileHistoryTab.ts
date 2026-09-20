/**
 * 文件历史 / Git Blame tab 契约 —— 详情页右键「Git 操作 ▸ 显示文件历史/Blame」入口。
 * tab id 按绝对路径锚定(重复打开即聚焦);path 取 `<cwd>/<相对路径>`:
 * AppShell tab 标签渲染 baseName(path) → 文件名。呈现面在 fileHistoryViews.tsx。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";

export const FILE_HISTORY_TAB_KIND = "git-file-history";

export interface FileHistoryTabPayload {
  cwd: string;
  /** 仓库相对路径(git ipc 口径) */
  path: string;
}

export function openFileHistoryTab(tab: FileHistoryTabPayload): void {
  const absPath = `${tab.cwd}/${tab.path}`;
  openTab(
    {
      id: `${FILE_HISTORY_TAB_KIND}:${absPath}`,
      kind: FILE_HISTORY_TAB_KIND,
      title: t("{path} — 文件历史", { path: tab.path.split("/").pop() ?? tab.path }),
      path: absPath,
      payload: { ...tab },
    },
    { refresh: true },
  );
}

/** tab kind → payload;非本族 kind 返回 null(kernel/tabs 路由方守卫用)。 */
export function readPayload(kind: string, raw: unknown): FileHistoryTabPayload | null {
  if (kind !== FILE_HISTORY_TAB_KIND) return null;
  const p = raw as Partial<FileHistoryTabPayload> | null;
  if (!p?.cwd || !p?.path) return null;
  return { cwd: p.cwd, path: p.path };
}
