/**
 * 选择壁纸弹窗 —— 本地图库网格:导入(多选,复制进受管目录)/点选/隐藏/恢复/移除。
 *
 * 交互对齐 codemoss WorkspaceWallpaperPicker 的库 tab(v1 无市场 tab):
 * 隐藏 = 软删除只出网格;移除 = 废纸篓受管副本 + 删行;同源重复导入直接复用
 * 已有条目并取消隐藏。实色 DialogShell(弹层不透底,可读性优先)。
 */

import { useMemo, useState } from "react";
import { Eye, EyeClosed, ImagesSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { DialogShell } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import { ipc, pickImageFiles } from "@kernel/ipc";
import {
  fileExtensionOf,
  findDuplicateItem,
  resolveSelectedId,
  wallpaperItemName,
  type WallpaperLibraryItem,
} from "./types";
import {
  joinPath,
  updateWallpaperState,
  useWallpaperState,
  wallpaperLibraryDir,
} from "./store";
import { useWallpaperSrc } from "./useWallpaperSrc";

function WallpaperCard({
  item,
  active,
  onSelect,
  onHide,
  onRemove,
}: {
  item: WallpaperLibraryItem;
  active: boolean;
  onSelect: () => void;
  onHide: () => void;
  onRemove: () => void;
}) {
  const preview = useWallpaperSrc(item.path);
  return (
    <li
      className={`wp-picker-card${active ? " is-active" : ""}${item.hidden ? " is-hidden" : ""}`}
    >
      <button
        type="button"
        className="wp-picker-thumb"
        aria-pressed={active}
        aria-label={wallpaperItemName(item)}
        onClick={onSelect}
      >
        <img
          src={preview.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={preview.handleError}
        />
        {preview.failed ? <span className="wp-picker-broken">{t("无法预览")}</span> : null}
      </button>
      <div className="wp-picker-meta">
        <span className="wp-picker-name" title={wallpaperItemName(item)}>
          {wallpaperItemName(item)}
        </span>
        <span className="wp-picker-actions">
          <button
            type="button"
            className="wp-picker-act"
            title={item.hidden ? t("恢复到图库") : t("从图库隐藏(不删文件)")}
            onClick={onHide}
          >
            {item.hidden ? <Eye size={13} aria-hidden /> : <EyeClosed size={13} aria-hidden />}
          </button>
          <button
            type="button"
            className="wp-picker-act wp-picker-act--danger"
            title={t("移入废纸篓并从图库移除")}
            onClick={onRemove}
          >
            <Trash size={13} aria-hidden />
          </button>
        </span>
      </div>
    </li>
  );
}

/** 纯规划:逐源定去留(去重复用/新副本落点名),不动磁盘。 */
function planImport(
  library: WallpaperLibraryItem[],
  sourcePaths: string[],
  dir: string,
): { next: WallpaperLibraryItem[]; copies: WallpaperLibraryItem[]; lastId: string | null } {
  const next = library.map((item) => ({ ...item }));
  const copies: WallpaperLibraryItem[] = [];
  const plannedKeys = new Set<string>();
  let lastId: string | null = null;
  for (const sourcePath of sourcePaths) {
    const duplicate = findDuplicateItem(next, sourcePath);
    if (duplicate) {
      for (const item of next) {
        if (item.id === duplicate.id) item.hidden = false;
      }
      lastId = duplicate.id;
      continue;
    }
    const key = sourcePath.replace(/\\/g, "/").toLowerCase();
    if (plannedKeys.has(key)) continue;
    plannedKeys.add(key);
    const extension = fileExtensionOf(sourcePath);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const item: WallpaperLibraryItem = {
      id,
      path: joinPath(dir, `${id}.${extension}`),
      sourcePath,
      hidden: false,
    };
    copies.push(item);
    next.push(item);
    lastId = id;
  }
  return { next, copies, lastId };
}

export function WallpaperPicker({ onClose }: { onClose: () => void }) {
  const state = useWallpaperState();
  const [showHidden, setShowHidden] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = resolveSelectedId(state.library, state.selectedId);
  const hiddenCount = state.library.filter((item) => item.hidden === true).length;
  const items = useMemo(
    () =>
      state.library.filter((item) =>
        showHidden ? item.hidden === true : item.hidden !== true,
      ),
    [state.library, showHidden],
  );

  const persistLibrary = (
    library: WallpaperLibraryItem[],
    selectedLibraryId?: string,
  ): void => {
    updateWallpaperState({
      mode: "image",
      library,
      selectedId: selectedLibraryId ?? resolveSelectedId(library, state.selectedId),
    });
  };

  const handleImport = async (): Promise<void> => {
    setError(null);
    let paths: string[] = [];
    try {
      paths = await pickImageFiles(t("选择壁纸图片"));
    } catch {
      return;
    }
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const dir = await wallpaperLibraryDir();
      const plan = planImport(state.library, paths.map((p) => p.trim()).filter(Boolean), dir);
      /* 并行复制(互不依赖);整批失败则不写库,零散孤儿副本不进 library 即不可见。 */
      await Promise.all(plan.copies.map((item) => ipc.fsCopyFile(item.sourcePath!, item.path)));
      persistLibrary(plan.next, plan.lastId ?? undefined);
      if (showHidden) setShowHidden(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleSelect = (item: WallpaperLibraryItem): void => {
    if (item.hidden) {
      persistLibrary(
        state.library.map((entry) =>
          entry.id === item.id ? { ...entry, hidden: false } : entry,
        ),
        item.id,
      );
      setShowHidden(false);
      return;
    }
    updateWallpaperState({ mode: "image", selectedId: item.id });
    onClose();
  };

  const handleHide = (item: WallpaperLibraryItem): void => {
    updateWallpaperState({
      library: state.library.map((entry) =>
        entry.id === item.id ? { ...entry, hidden: entry.hidden !== true } : entry,
      ),
    });
  };

  const handleRemove = async (item: WallpaperLibraryItem): Promise<void> => {
    try {
      await ipc.fsTrashEntry(item.path);
    } catch {
      /* 文件可能已被手动清理;库行照删。 */
    }
    updateWallpaperState({ library: state.library.filter((entry) => entry.id !== item.id) });
  };

  return (
    <DialogShell
      title={t("选择壁纸")}
      icon={<ImagesSquare size="0.875rem" aria-hidden />}
      width={720}
      onClose={onClose}
      footer={
        <div className="wp-picker-footer">
          {error ? <span className="wp-picker-error">{error}</span> : <span />}
          <button
            type="button"
            className="wp-picker-import"
            disabled={importing}
            onClick={() => void handleImport()}
          >
            <UploadSimple size={13} aria-hidden />
            {importing ? t("导入中…") : t("导入图片")}
          </button>
        </div>
      }
    >
      <div className="wp-picker-toolbar">
        <span className="wp-picker-count">
          {showHidden
            ? t("已隐藏({count})", { count: hiddenCount })
            : t("图库({count})", { count: state.library.length - hiddenCount })}
        </span>
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="wp-picker-toggle-hidden"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? t("返回图库") : t("查看已隐藏")}
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="wp-picker-empty">
          {showHidden
            ? t("没有已隐藏的壁纸。")
            : t("图库为空,点「导入图片」选择本地图片。")}
        </div>
      ) : (
        <ul className="wp-picker-grid">
          {items.map((item) => (
            <WallpaperCard
              key={item.id}
              item={item}
              active={item.id === selectedId && item.hidden !== true}
              onSelect={() => handleSelect(item)}
              onHide={() => handleHide(item)}
              onRemove={() => void handleRemove(item)}
            />
          ))}
        </ul>
      )}
    </DialogShell>
  );
}
