/**
 * 文件详情页 Git Blame 内嵌模式 —— 开关 + 拉取 + 注入 CM gutter。
 * 呈现归 kernel/cmEditor/editorBlame(marker),本钩子只管数据面与生命周期;
 * CM 重库一律动态 import(不进 files 插件静态图),切文件/关模式清 marker,
 * 竞态用递增序号守卫。
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ipc } from "@kernel/ipc";
import { formatAbsolute } from "@kernel/relativeTime";
import { getActiveWorkspace } from "@kernel/workspace";
import type { BlameViewLike } from "@kernel/cmEditor/editorBlame";

export function useFileBlame(opts: {
  path: string;
  /** 编辑态且本地文件时可开(远程/预览态不出菜单项)。 */
  active: boolean;
  viewRef: RefObject<unknown>;
}): { blameOn: boolean; toggleBlame: () => void } {
  const { path, active, viewRef } = opts;
  const [blameOn, setBlameOn] = useState(false);
  const seqRef = useRef(0);
  const { wsRoot, relPath } = useMemo(() => {
    const ws = getActiveWorkspace();
    const base = ws ? ws.root.replace(/[\\/]+$/, "") : "";
    return { wsRoot: base, relPath: base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "" };
  }, [path]);

  useEffect(() => {
    if (!blameOn || !active || !relPath) return;
    const view = viewRef.current as BlameViewLike | null;
    if (!view) return;
    const mine = ++seqRef.current;
    void import("@kernel/cmEditor/editorBlame").then(({ setEditorBlame }) => {
      if (mine !== seqRef.current) return;
      ipc.gitBlame(wsRoot, relPath).then(
        (lines) => {
          if (mine !== seqRef.current) return;
          setEditorBlame(
            view,
            lines.map((l) => ({
              lineNo: l.lineNo,
              shortSha: l.shortSha,
              summary: l.summary,
              authorName: l.authorName,
              authorWhen: l.authorWhen,
              boundary: l.boundary,
              label: `${l.shortSha} ${l.authorName} ${formatAbsolute(l.authorWhen * 1000)}`,
            })),
          );
        },
        () => {
          if (mine === seqRef.current) setEditorBlame(view, null);
        },
      );
    });
    return () => {
      seqRef.current++;
      void import("@kernel/cmEditor/editorBlame").then(({ setEditorBlame }) => setEditorBlame(view, null));
    };
  }, [blameOn, active, relPath, wsRoot, viewRef]);

  return { blameOn: blameOn && Boolean(relPath), toggleBlame: () => setBlameOn((v) => !v) };
}
