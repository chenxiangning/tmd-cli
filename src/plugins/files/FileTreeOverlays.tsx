/**
 * 文件树尾部覆盖层 —— 操作提示 + 右键菜单 + 命名弹窗。
 * 自 FileTree.tsx 拆出(文件规模铁则 + no-high-complexity 降分支)。
 */

import { t } from "@kernel/i18n";
import type { DirEntry } from "@kernel/ipc";
import { type TreeMenuState } from "./useTreeOperations";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { NamePrompt } from "./NamePrompt";

/** 命名弹窗态(与 useTreeOperations 内部 TreePrompt 同构,该类型未导出)。 */
type PromptState =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename"; entry: DirEntry };

export function FileTreeOverlays({
  root,
  notice,
  menu,
  prompt,
  promptError,
  openPrompt,
  copyPath,
  revealInFileManager,
  trash,
  closeMenu,
  closePrompt,
  submitPrompt,
}: {
  root: string;
  notice: string | null;
  menu: TreeMenuState | null;
  prompt: PromptState | null;
  promptError: string | null;
  openPrompt: (p: PromptState) => void;
  copyPath: (entry: DirEntry) => void;
  revealInFileManager: (entry: DirEntry) => void;
  trash: (entry: DirEntry) => Promise<void>;
  closeMenu: () => void;
  closePrompt: () => void;
  submitPrompt: (name: string) => void;
}) {
  return (
    <>
      {notice ? (
        <div className="file-tree-notice" role="status">
          {notice}
        </div>
      ) : null}

      {menu ? (
        <FileTreeContextMenu
          state={menu}
          root={root}
          actions={{
            createFile: (dir) => openPrompt({ kind: "new-file", dir }),
            createFolder: (dir) => openPrompt({ kind: "new-folder", dir }),
            rename: (entry) => openPrompt({ kind: "rename", entry }),
            copyPath,
            reveal: revealInFileManager,
            trash: (entry) => void trash(entry),
          }}
          onClose={closeMenu}
        />
      ) : null}

      {prompt ? (
        <NamePrompt
          title={
            prompt.kind === "new-file"
              ? t("新建文件")
              : prompt.kind === "new-folder"
                ? t("新建文件夹")
                : t("重命名")
          }
          parentPath={prompt.kind === "rename" ? prompt.entry.path : prompt.dir}
          initialName={prompt.kind === "rename" ? prompt.entry.name : undefined}
          confirmLabel={prompt.kind === "rename" ? t("重命名") : t("创建")}
          error={promptError}
          onCancel={closePrompt}
          onConfirm={submitPrompt}
        />
      ) : null}
    </>
  );
}
