/**
 * DiffTab —— 中央「工作区 diff」tab(editorCenter.tabContent 挂载)。
 *
 * 一仓一侧一 tab(与提交 diff tab 同构):头(侧标签 + 仓根 + 文件数 + 视图切换)
 * + 左列变更清单 + 右侧选中文件 patch。清单走 useGitStatus 5s 轮询(与右栏面板
 * 同 hook),幕布改盘自动跟进;选中文件被暂存/还原消失时渲染期回落清单首个。
 * patch 按需单文件拉(gitDiffFilePatch),token 防 cwd/切文件竞态。
 * kind 路由由 kernel/tabs 注册表保证,本组件只见 git-diff tab。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { EditorTab } from "@kernel/tabs";
import { ipc, type GitFilePatch, type GitFileStatus, type GitTotals } from "@kernel/ipc";
import { readDiffTabPayload, type DiffTabPayload } from "./diffTab";
import { gitErrorDisplay, gitErrorMessage } from "./gitError";
import { useGitStatus } from "./hooks/useGitStatus";
import { useGitTotals } from "./hooks/useGitTotals";
import { DiffPatchPane } from "./views/DiffPatchPane";
import { DiffModeToggle } from "./views/DiffModeToggle";
import { countFoldRuns } from "./views/patchModel";
import { STATUS_COLOR } from "./views/statusColor";
import { useGitPanelState } from "./panelStore";

export function DiffTabContent({ tab }: { tab: EditorTab }) {
  const payload = readDiffTabPayload(tab);
  if (!payload) return null;
  return <DiffTab key={`${payload.cwd}:${payload.staged ? "s" : "w"}`} payload={payload} />;
}

function DiffTab({ payload }: { payload: DiffTabPayload }) {
  const { data, loading, error } = useGitStatus(payload.cwd);
  const { data: totals } = useGitTotals(payload.cwd);
  const { diffMode } = useGitPanelState();
  const files = (data?.files ?? []).filter((f) => (payload.staged ? f.staged : f.wt));

  /* 选中文件:用户点选 ?? payload 深链;仓/侧/深链换代作废旧点选(带 key 比对),
     首扫到位后选中失效(文件没了)渲染期直接回落首个文件 —— 全部派生,无同步 effect。 */
  const selKey = `${payload.cwd}:${payload.staged}:${payload.focusPath ?? ""}`;
  const [picked, setPicked] = useState<{ key: string; path: string } | null>(null);
  const requested = picked && picked.key === selKey ? picked.path : (payload.focusPath ?? null);
  const selected = !data
    ? requested
    : requested && files.some((f) => f.path === requested)
      ? requested
      : (files[0]?.path ?? null);

  /* 全文查看:per-tab 本地态,默认关;切文件即复位(见清单 onPick)。
     expandFolds:折叠段展开入口在头部工具条(就地胶囊已废);同随切文件复位。 */
  const [fullView, setFullView] = useState(false);
  const [expandFolds, setExpandFolds] = useState(false);
  const { patch, patchLoading, patchError } = useFilePatch(
    payload.cwd,
    selected,
    payload.staged,
    fullView,
    data,
  );
  const foldable = useMemo(
    () => (fullView && patch ? countFoldRuns(patch.patch, diffMode === "split") > 0 : false),
    [fullView, patch, diffMode],
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-xs" data-icon-decor="git-zone">
      {/* 头:侧标签 + 仓根 + 文件数 + 视图切换 */}
      <div className="shrink-0 border-b border-(--tmd-border) px-3 py-2">
        <div className="truncate font-medium text-(--tmd-fg)">
          {payload.staged ? t("已暂存 → HEAD") : t("工作区 → 暂存区")}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-(--tmd-fg-muted)">
          <span className="min-w-0 truncate font-mono" title={payload.cwd}>
            {payload.cwd}
          </span>
          <span className="flex-1" />
          {data && (
            <span className="shrink-0 tabular-nums text-(--tmd-fg-faint)">
              {t("{n} 文件", { n: files.length })}
            </span>
          )}
          <DiffModeToggle
            fullView={fullView}
            onToggleFullView={() => {
              setFullView((v) => !v);
              setExpandFolds(false);
            }}
            folds={foldable}
            expandFolds={expandFolds}
            onToggleFolds={() => setExpandFolds((v) => !v)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <WorktreeFileList
          files={files}
          totals={totals}
          staged={payload.staged}
          loading={loading && !data}
          error={error}
          selected={selected}
          onPick={(path) => {
            setPicked({ key: selKey, path });
            setFullView(false); /* 全文查看只管当前文件,下个文件重新开 */
            setExpandFolds(false);
          }}
        />
        <DiffPatchPane
          patchLoading={patchLoading}
          patchError={patchError}
          patch={patch}
          selected={selected}
          diffMode={diffMode}
          fullView={fullView}
          expandFolds={expandFolds}
          emptyText={t("无 diff 数据")}
        />
      </div>
    </div>
  );
}

/** 每次选中即拉最新 patch,不做缓存;token 防竞态。
 *  live = useGitStatus 的轮询数据:身份换代(值等守卫后 = 仓状态真变)即对所选
 *  文件静默重拉(不动 loading 旗,旧 patch 留屏防闪)——tab 一仓常驻后,
 *  「幕布改盘、重开即新鲜」的旧通道由轮询继承。 */
function useFilePatch(
  cwd: string,
  path: string | null,
  staged: boolean,
  fullView: boolean,
  live: unknown,
): { patch: GitFilePatch | null; patchLoading: boolean; patchError: string | null } {
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!path) {
      loadedKeyRef.current = null;
      setPatch(null);
      setPatchLoading(false);
      setPatchError(null);
      return;
    }
    const key = `${cwd}${path}${staged}${fullView}`;
    const silent = loadedKeyRef.current === key; // 仅 live 换代:静默重拉
    const myToken = ++tokenRef.current;
    if (!silent) setPatchLoading(true);
    setPatchError(null);
    ipc.gitDiffFilePatch(cwd, path, staged, fullView).then(
      (p) => {
        if (myToken !== tokenRef.current) return;
        loadedKeyRef.current = key;
        setPatch(p);
        setPatchLoading(false);
      },
      (e: unknown) => {
        if (myToken !== tokenRef.current) return;
        setPatchError(gitErrorMessage(e));
        setPatchLoading(false);
      },
    );
  }, [cwd, path, staged, fullView, live]);
  return { patch, patchLoading, patchError };
}

/** 左列变更清单:状态字母 + 文件名/目录 + ±行数(totals 低频命令,到位前不显数字)。 */
function WorktreeFileList({
  files,
  totals,
  staged,
  loading,
  error,
  selected,
  onPick,
}: {
  files: GitFileStatus[];
  totals: GitTotals | null;
  staged: boolean;
  loading: boolean;
  error: string | null;
  selected: string | null;
  onPick: (path: string) => void;
}) {
  const totalsMap = useMemo(
    () => new Map((totals?.files ?? []).filter((f) => f.staged === staged).map((f) => [f.path, f])),
    [totals, staged],
  );
  return (
    <div className="w-60 shrink-0 overflow-y-auto border-r border-(--tmd-border)">
      {loading && (
        <div className="flex items-center justify-center gap-1.5 py-3 text-(--tmd-fg-faint)">
          <Spinner /> {t("加载中…")}
        </div>
      )}
      {error && <div className="px-2 py-2 text-(--tmd-diff-removed)">{gitErrorDisplay(error)}</div>}
      {!loading && !error && files.length === 0 && (
        <div className="px-2 py-3 text-center text-(--tmd-fg-faint)">{t("此侧无变更")}</div>
      )}
      {files.map((f) => {
        const name = f.path.split("/").pop() ?? f.path;
        const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
        const nums = totalsMap.get(f.path);
        const activeFile = f.path === selected;
        return (
          <button
            key={`${f.status}:${f.oldPath ?? ""}:${f.path}`}
            type="button"
            onClick={() => onPick(f.path)}
            title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            className={`flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-(--tmd-bg-hover) ${
              activeFile ? "bg-(--tmd-bg-active)" : ""
            }`}
          >
            <span
              className={`w-3 shrink-0 text-center font-semibold ${STATUS_COLOR[f.status] ?? ""}`}
            >
              {f.status === "?" ? "U" : f.status}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{name}</span>
              {dir && <span className="ml-1 text-meta text-(--tmd-fg-faint)">{dir}</span>}
            </span>
            {nums && (nums.insertions > 0 || nums.deletions > 0) && (
              <span className="shrink-0 tabular-nums text-meta text-(--tmd-fg-faint)">
                <span className="text-(--tmd-diff-inserted)">+{nums.insertions}</span>{" "}
                <span className="text-(--tmd-diff-removed)">-{nums.deletions}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
