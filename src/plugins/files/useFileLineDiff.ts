/**
 * 文件详情页行号槽 diff 着色 —— 跟随文件树「Git 变更着色」总开关
 * (gitDecorateModel 同一 store):开 + 编辑态 + 本地仓内文件时,拉
 * git_diff_file_patch(worktree vs index,3 行上下文;标记只需 hunk 头行号与
 * ± 行,截断上下文下标记集与 full 全文态逐位等价,免去大文件全文过 IPC)
 * 解析逐行 add/mod/del 标记注入 CM gutter;关/切文件/卸载清除。
 * 新鲜度 = 打开/保存/磁盘外变各拉一次,行编辑期 marker 经 CM 变更映射随行漂移
 * (不重拉,下一轮保存对齐);呈现归 kernel/cmEditor/editorDiffGutter。
 */
import { useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import { ipc } from "@kernel/ipc";
import { normalizePath } from "@kernel/pathUtils";
import { getActiveWorkspace } from "@kernel/workspace";
import type { BlameViewLike } from "@kernel/cmEditor/editorBlame";
import type { LineMark } from "@kernel/cmEditor/editorDiffGutter";
import { isGitDecorateEnabled, subscribe } from "./gitDecorateModel";

const inject = (view: BlameViewLike, marks: readonly LineMark[] | null) =>
  import("@kernel/cmEditor/editorDiffGutter").then((m) => m.setEditorLineDiff(view, marks));

export function useFileLineDiff(opts: {
  path: string;
  /** 编辑态且本地文件时启用(远程/预览态零效果)。 */
  active: boolean;
  /** 文档脏标志:变脏期间不重拉(标记随行漂移),落定回净时重拉对齐。 */
  dirty: boolean;
  viewRef: RefObject<unknown>;
  /** 编辑器挂载信号:view 就绪后自增,驱动首拉(viewRef.current 初值常为 null)。 */
  viewTick: number;
  /** 磁盘外变信号(useFileDocument 重读正文时自增):驱动重拉对齐标记。 */
  diskTick: number;
}): void {
  const { path, active, dirty, viewRef, viewTick, diskTick } = opts;
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  const { wsRoot, relPath } = useMemo(() => {
    /* Windows 目录选择器回传反斜杠根:path 已 normalize,base 不 normalize 则
     * startsWith 永假 → 行级着色在 win 上整体静默失效(2026-10-09 评审 P1)。 */
    const ws = getActiveWorkspace();
    const base = ws ? normalizePath(ws.root) : "";
    const p = normalizePath(path);
    return { wsRoot: base, relPath: base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : "" };
  }, [path]);

  useEffect(() => {
    if (!on || !active || !relPath || dirty) return;
    const view = viewRef.current as BlameViewLike | null;
    if (!view) return;
    let alive = true;
    void ipc.gitDiffFilePatch(wsRoot, relPath, false, false).then(
      (patch) => {
        if (!alive) return;
        void import("@kernel/cmEditor/editorDiffGutter").then((m) => {
          if (alive) m.setEditorLineDiff(view, patch && !patch.binary ? m.lineMarksFromPatch(patch.patch) : null);
        });
      },
      () => { if (alive) void inject(view, null); },
    );
    return () => { alive = false; };
  }, [on, active, relPath, wsRoot, dirty, viewRef, viewTick, diskTick]);

  /* 开关关掉/出编辑态:清除标记(数据 effect 的 alive 管竞态,本 effect 管呈现)。 */
  useEffect(() => {
    if (on && active) return;
    const view = viewRef.current as BlameViewLike | null;
    if (view) void inject(view, null);
  }, [on, active, viewRef, viewTick]);
}
