/**
 * 侧栏文件浏览器三种列表态 —— 全部文件(右栏同源懒展开)/ 仅变更(剪枝树)/
 * 搜索命中(平铺)。装饰口径:着色与字母复用 gitDecorate 纯函数产物,
 * 目录行圆点(着色表含祖先聚合)、文件行字母;忽略前缀整棵降显。
 * 行右键统一走 rowMenu(右栏同款 useTreeOperations 菜单)。
 */

import type { DirEntry } from "@kernel/ipc";
import { openFileInTab } from "@kernel/fileTabs";
import { isIgnoredPath, type ChangedChild } from "./workspaceBrowserModel";
import { WsfbRow, type RowDeco } from "./WsfbRow";

/** 行右键构造器:entry 三元组 → 事件处理器(右栏 FileTree.rowMenu 同形)。 */
export type WsfbRowMenu = (
  entry: Pick<DirEntry, "path" | "name" | "isDir">,
) => (e: React.MouseEvent) => void;

/** 文件行装饰:着色或字母任一命中即挂(字母优先展示,色兜底前景色)。 */
function fileDecoOf(
  colors: ReadonlyMap<string, string>,
  letters: ReadonlyMap<string, string>,
  path: string,
): RowDeco | null {
  const color = colors.get(path);
  const letter = letters.get(path);
  if (!color && letter === undefined) return null;
  return { color: color ?? "text-(--tmd-fg)", letter };
}

/* 折叠 untracked 目录在 status 里带尾斜杠,着色表键同形 —— 双口径回查。 */
function dirDecoOf(colors: ReadonlyMap<string, string>, path: string): RowDeco | null {
  const color = colors.get(path) ?? colors.get(`${path}/`);
  return color ? { color } : null;
}

/** 全部文件态:fsListDir 懒展开(与右栏 FileTree 同一 useDirTree 数据)。 */
export function WsfbAllFilesList({
  entries,
  expanded,
  selectedPath,
  colors,
  letters,
  ignored,
  rowMenu,
  onToggle,
}: {
  entries: readonly DirEntry[];
  expanded: Record<string, DirEntry[]>;
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  ignored: readonly string[];
  rowMenu: WsfbRowMenu;
  onToggle: (entry: DirEntry) => void;
}) {
  const render = (list: readonly DirEntry[], depth: number): React.ReactNode =>
    list.map((e) => {
      const isOpen = expanded[e.path] !== undefined;
      return (
        <div key={e.path}>
          <WsfbRow
            path={e.path}
            name={e.name}
            isDir={e.isDir}
            open={isOpen}
            depth={depth}
            deco={e.isDir ? dirDecoOf(colors, e.path) : fileDecoOf(colors, letters, e.path)}
            dim={isIgnoredPath(e.path, ignored)}
            selected={selectedPath === e.path}
            onContextMenu={rowMenu(e)}
            onClick={() => onToggle(e)}
          />
          {isOpen && (
            <div
              className="wsfb-children"
              style={{ ["--wsfb-guide" as string]: `${depth * 14 + 14}px` }}
            >
              {render(expanded[e.path] ?? [], depth + 1)}
            </div>
          )}
        </div>
      );
    });
  return <>{render(entries, 0)}</>;
}

/** 仅变更态:剪枝树(目录条目 = 变更文件祖先链;子项未知目录不可展开)。 */
export function WsfbChangedList({
  rootKids,
  changedTree,
  changedOpen,
  selectedPath,
  colors,
  letters,
  rowMenu,
  onSelect,
  onToggleDir,
}: {
  rootKids: readonly ChangedChild[];
  changedTree: ReadonlyMap<string, readonly ChangedChild[]>;
  changedOpen: Record<string, true>;
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  rowMenu: WsfbRowMenu;
  onSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
}) {
  const render = (list: readonly ChangedChild[], depth: number): React.ReactNode =>
    list.map((c) => {
      const kids = changedTree.get(c.path) ?? [];
      const isOpen = changedOpen[c.path] === true;
      const expandable = kids.length > 0;
      return (
        <div key={c.path}>
          <WsfbRow
            path={c.path}
            name={c.name}
            isDir={c.isDir}
            open={isOpen}
            depth={depth}
            deco={c.isDir ? dirDecoOf(colors, c.path) : fileDecoOf(colors, letters, c.path)}
            dim={false}
            selected={selectedPath === c.path}
            expandable={expandable}
            onContextMenu={rowMenu(c)}
            onClick={() => {
              onSelect(c.path);
              if (!c.isDir) {
                openFileInTab(c.path);
                return;
              }
              if (expandable) onToggleDir(c.path);
            }}
          />
          {c.isDir && isOpen && (
            <div
              className="wsfb-children"
              style={{ ["--wsfb-guide" as string]: `${depth * 14 + 14}px` }}
            >
              {render(kids, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  return <>{render(rootKids, 0)}</>;
}

/** 搜索态:命中平铺(点击开 tab)。 */
export function WsfbSearchList({
  hits,
  selectedPath,
  colors,
  letters,
  ignored,
  rowMenu,
  onPick,
}: {
  hits: readonly string[];
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  ignored: readonly string[];
  rowMenu: WsfbRowMenu;
  onPick: (path: string) => void;
}) {
  return (
    <>
      {hits.map((p) => (
        <WsfbRow
          key={p}
          path={p}
          name={p.split("/").pop() ?? p}
          isDir={false}
          open={false}
          depth={0}
          deco={fileDecoOf(colors, letters, p)}
          dim={isIgnoredPath(p, ignored)}
          selected={selectedPath === p}
          expandable={false}
          onContextMenu={rowMenu({ path: p, name: p.split("/").pop() ?? p, isDir: false })}
          onClick={() => onPick(p)}
        />
      ))}
    </>
  );
}
