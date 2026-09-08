/**
 * 文件行小图标动作 —— 打开文件(中央文件区文件 tab)+ 打开文件位置(系统文件管理器)。
 *
 * 链路说明(无插件间通讯,均为内核原语直调):
 * - 打开文件:kernel openTab 的 kind "file" 路由,渲染方注册在 files 插件,
 *   kind 字面量契约由 src/plugins/tabContent.contract.test.ts 双向锁定;
 * - 打开位置:kernel ipc.fsRevealInFileManager(Rust fs_reveal_in_file_manager)。
 */

import { t } from "@kernel/i18n";
import { FileText, FolderOpen } from "@phosphor-icons/react";
import { openTab } from "@kernel/tabs";
import { baseName } from "@kernel/pathUtils";
import { ipc, type GitFileStatus } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";

/** 仓库相对路径 → 绝对路径(git 恒以 `/` 给路径;拼法同 files 插件 joinPath)。 */
function worktreeAbsPath(cwd: string, relPath: string): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${relPath}`;
}

/** 在中央文件区打开工作区文件(与 files 插件树点击同一 kind "file" 契约)。 */
function openWorktreeFile(cwd: string, relPath: string): void {
  const abs = worktreeAbsPath(cwd, relPath);
  openTab({
    id: `file:${abs}`,
    kind: "file",
    title: baseName(abs) || abs,
    path: abs,
    payload: { path: abs },
  });
}

/**
 * hover 动作位的两个小图标;status D(盘上已无文件)不渲染。
 * 冲突行由调用方规避(flat 行动作位整体不出现 / 树形行走冲突分支)。
 */
export function FileOpenActions({ cwd, file }: { cwd: string; file: GitFileStatus }) {
  if (file.status === "D") return null;
  const abs = worktreeAbsPath(cwd, file.path);
  return (
    <>
      <button
        type="button"
        title={t("打开文件")}
        onClick={(e) => {
          e.stopPropagation();
          openWorktreeFile(cwd, file.path);
        }}
        className="shrink-0 text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
      >
        <FileText className="h-[0.75rem] w-[0.75rem]" />
      </button>
      <button
        type="button"
        title={t("打开文件位置")}
        onClick={(e) => {
          e.stopPropagation();
          ipc.fsRevealInFileManager(abs).catch((err) => console.warn(gitErrorDisplay(err)));
        }}
        className="shrink-0 text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
      >
        <FolderOpen className="h-[0.75rem] w-[0.75rem]" />
      </button>
    </>
  );
}
