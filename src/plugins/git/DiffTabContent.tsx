/**
 * DiffTab —— 中央「工作区 diff」tab(editorCenter.tabContent 挂载)。
 *
 * 一文件一侧一 tab:头部(状态字母 + 路径 + 侧标签 + ±行数)+ patch 主体。
 * 每次挂载即拉最新(gitDiffFilePatch),不做缓存 —— 幕布终端随时改盘,
 * 重开 tab 即新鲜;token 防 cwd/切 tab 竞态。
 * 非 git-diff kind 的 tab 返回 null —— 每 kind 由各自插件渲染。
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useEditorTabs } from "@kernel/tabs";
import { ipc, type GitFilePatch } from "@kernel/ipc";
import { readDiffTabPayload, type DiffTabPayload } from "./diffTab";
import { gitErrorMessage } from "./gitError";
import { PatchLines } from "./views/PatchLines";
import { STATUS_COLOR } from "./views/statusColor";

export function DiffTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const payload = active ? readDiffTabPayload(active) : null;
  if (!active || !payload) return null;
  return (
    <DiffTab
      key={`${payload.cwd}:${payload.staged ? "s" : "w"}:${payload.path}`}
      payload={payload}
    />
  );
}

function DiffTab({ payload }: { payload: DiffTabPayload }) {
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const myToken = ++tokenRef.current;
    setLoading(true);
    setError(null);
    ipc.gitDiffFilePatch(payload.cwd, payload.path, payload.staged).then(
      (p) => {
        if (myToken !== tokenRef.current) return;
        setPatch(p);
        setLoading(false);
      },
      (e: unknown) => {
        if (myToken !== tokenRef.current) return;
        setError(gitErrorMessage(e));
        setLoading(false);
      },
    );
  }, [payload.cwd, payload.path, payload.staged]);

  const name = payload.path.split("/").pop() ?? payload.path;
  const dir = payload.path.includes("/")
    ? payload.path.slice(0, payload.path.lastIndexOf("/"))
    : "";
  const displayStatus = payload.status === "?" ? "U" : payload.status;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      {/* 文件头 */}
      <div className="shrink-0 border-b border-(--tmd-border) px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`shrink-0 font-mono text-[10px] font-semibold ${STATUS_COLOR[payload.status] ?? ""}`}
          >
            {displayStatus}
          </span>
          <span className="truncate font-medium text-(--tmd-fg)" title={payload.path}>
            {name}
          </span>
          {dir && <span className="truncate text-[10px] text-(--tmd-fg-faint)">{dir}</span>}
          <span className="flex-1" />
          {patch && !patch.binary && (
            <span className="shrink-0 tabular-nums text-[10px] text-(--tmd-fg-faint)">
              <span className="text-(--tmd-diff-inserted)">+{patch.additions}</span>{" "}
              <span className="text-(--tmd-diff-removed)">-{patch.deletions}</span>
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-(--tmd-fg-muted)">
          {payload.staged ? "已暂存 → HEAD" : "工作区 → 暂存区"}
        </div>
      </div>

      {/* patch 区 */}
      <div className="min-w-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-1.5 py-6 text-(--tmd-fg-faint)">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载 diff…
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-(--tmd-diff-removed)">{error.replace(/^E_[A-Z_]+:\s*/, "")}</div>
        ) : patch?.binary ? (
          <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">二进制文件,无文本 diff</div>
        ) : patch ? (
          <PatchLines text={patch.patch} className="h-max min-h-full" />
        ) : (
          <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">无 diff 数据</div>
        )}
      </div>
    </div>
  );
}
