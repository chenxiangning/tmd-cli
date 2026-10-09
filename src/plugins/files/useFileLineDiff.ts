/**
 * 文件详情页行号槽 diff 着色 —— 跟随文件树「Git 变更着色」总开关
 * (gitDecorateModel 同一 store):开 + 编辑态 + 本地仓内文件时,拉
 * git_diff_file_patch(worktree vs index,full)解析逐行 add/mod/del 标记
 * 注入 CM gutter;关/切文件/卸载清除。
 * 新鲜度 = 打开/保存各拉一次,行编辑期 marker 经 CM 变更映射随行漂移
 * (不重拉,下一轮保存对齐);呈现归 kernel/cmEditor/editorDiffGutter。
 */
import { useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import { ipc } from "@kernel/ipc";
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
}): void {
  const { path, active, dirty, viewRef, viewTick } = opts;
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  const { wsRoot, relPath } = useMemo(() => {
    const ws = getActiveWorkspace();
    const base = ws ? ws.root.replace(/[\\/]+$/, "") : "";
    return { wsRoot: base, relPath: base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "" };
  }, [path]);

  useEffect(() => {
    if (!on || !active || !relPath || dirty) return;
    const view = viewRef.current as BlameViewLike | null;
    if (!view) return;
    let alive = true;
    void ipc.gitDiffFilePatch(wsRoot, relPath, false, true).then(
      (patch) => {
        if (!alive) return;
        void import("@kernel/cmEditor/editorDiffGutter").then((m) => {
          if (alive) m.setEditorLineDiff(view, patch && !patch.binary ? m.lineMarksFromPatch(patch.patch) : null);
        });
      },
      () => { if (alive) void inject(view, null); },
    );
    return () => { alive = false; };
  }, [on, active, relPath, wsRoot, dirty, viewRef, viewTick]);

  /* 开关关掉/出编辑态:清除标记(数据 effect 的 alive 管竞态,本 effect 管呈现)。 */
  useEffect(() => {
    if (on && active) return;
    const view = viewRef.current as BlameViewLike | null;
    if (view) void inject(view, null);
  }, [on, active, viewRef, viewTick]);
}
