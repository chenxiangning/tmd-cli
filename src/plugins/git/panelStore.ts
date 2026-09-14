/**
 * git 面板共享 store —— GitToolbar(面板顶行)与 GitPanel(右栏)是两个组件实例,
 * 视图态经模块级 store 共享(useSyncExternalStore,同 filePanel 模式)。
 *
 * aggregate:聚合 ±行数与文件数的只读镜像 —— totals 是重操作,只允许
 * GitPanel 的 useGitTotals 单点拉取,GitToolbar 经此消费,不做第二份轮询。
 */

import { useSyncExternalStore } from "react";
import type { GitTotals } from "@kernel/ipc";
import { getSettingsState, updateSettings, type GitDiffMode, type GitFileListLayout, type GitPanelView } from "@kernel/settings";

/** 视图段与文件列表布局的持久化契约归内核 settings(git 编辑域),此处只留插件侧旧名别名。 */
export type GitViewMode = GitPanelView;
export type FileListLayout = GitFileListLayout;

interface GitAggregate {
  totals: GitTotals | null;
  fileCount: number;
}

type RemoteDialogOp = "push" | "pull" | "fetch";


interface GitPanelState {
  view: GitViewMode;
  layout: FileListLayout;
  diffMode: GitDiffMode;
  /** diff 正文自动换行(落盘 git 域;默认开)。 */
  diffWrap: boolean;
  /** 顶栏视图下拉「刷新」→ 面板全量刷新。 */
  refreshNonce: number;
  aggregate: GitAggregate;
  /** 远端态镜像(GitPanel 单点拉取,顶栏下拉按钮只读消费):
   *  detached/hasUpstream 定禁用,ahead/behind 上计数,busy 上转圈。 */
  remoteMeta: GitRemoteMeta | null;
  /** 右键菜单等外部入口请求打开远端对话框;nonce 保证同 op 连发也触发 effect。 */
  remoteDialogRequest: { op: RemoteDialogOp; nonce: number } | null;
}

interface GitRemoteMeta {
  detached: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  busy: RemoteDialogOp | null;
}

const state: GitPanelState = {
  view: "diff",
  layout: "flat",
  diffMode: "unified",
  diffWrap: true,
  refreshNonce: 0,
  aggregate: { totals: null, fileCount: 0 },
  remoteMeta: null,
  remoteDialogRequest: null,
};
const listeners = new Set<() => void>();
let snapshot: GitPanelState = state;

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

export function setGitView(view: GitViewMode): void {
  state.view = view;
  persistPanelPrefs({ view });
  emit();
}

export function setGitLayout(layout: FileListLayout): void {
  state.layout = layout;
  persistPanelPrefs({ layout });
  emit();
}

export function setGitDiffMode(diffMode: GitDiffMode): void {
  state.diffMode = diffMode;
  persistPanelPrefs({ diffMode });
  emit();
}

export function setGitDiffWrap(diffWrap: boolean): void {
  state.diffWrap = diffWrap;
  persistPanelPrefs({ diffWrap });
  emit();
}

/** 视图/布局/diff 模式切换即写 settings(git 编辑域,settings.json 落盘);setter 是唯一写入口,水合不回写。 */
function persistPanelPrefs(
  patch: Partial<{ view: GitViewMode; layout: FileListLayout; diffMode: GitDiffMode; diffWrap: boolean }>,
): void {
  updateSettings({ git: { ...getSettingsState().settings.git, ...patch } });
}

/** 启动水合:插件 activate 时(设置已就绪)把落盘偏好搬进内存 store,不回写。 */
export function hydrateGitPanelPrefs(): void {
  state.view = getSettingsState().settings.git.view;
  state.layout = getSettingsState().settings.git.layout;
  state.diffMode = getSettingsState().settings.git.diffMode;
  state.diffWrap = getSettingsState().settings.git.diffWrap;
}

/** 顶栏视图下拉「刷新」行 → 面板全量刷新(useGitPanelData 监听 nonce)。 */
export function bumpGitRefresh(): void {
  state.refreshNonce += 1;
  emit();
}

/** GitPanel 拉到远端态后镜像(值等不 emit,防空转重渲染)。 */
export function setGitRemoteMeta(next: GitRemoteMeta): void {
  const prev = state.remoteMeta;
  if (
    prev &&
    prev.detached === next.detached &&
    prev.hasUpstream === next.hasUpstream &&
    prev.ahead === next.ahead &&
    prev.behind === next.behind &&
    prev.busy === next.busy
  )
    return;
  state.remoteMeta = next;
  emit();
}


/** GitPanel 拉到聚合数据后镜像(值不变不 emit,避免 5s 轮询空转重渲染)。 */
export function setGitAggregate(next: GitAggregate): void {
  const prev = state.aggregate;
  if (
    prev.totals === next.totals &&
    prev.fileCount === next.fileCount
  )
    return;
  state.aggregate = next;
  emit();
}


let remoteDialogNonce = 0;

/** 分支右键菜单「推送...」等入口 → GitPanel 打开对应远端对话框。 */
export function requestRemoteDialog(op: RemoteDialogOp): void {
  remoteDialogNonce += 1;
  state.remoteDialogRequest = { op, nonce: remoteDialogNonce };
  emit();
}

/** GitPanel 消费后清除,防止重复触发。 */
export function clearRemoteDialogRequest(): void {
  if (!state.remoteDialogRequest) return;
  state.remoteDialogRequest = null;
  emit();
}

export function useGitPanelState(): GitPanelState {
  const getSnapshot = () => snapshot;
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot,
    getSnapshot, // SSR(renderToStaticMarkup 测试)同源快照
  );
}

/* ── 「暂存并切换」来源(未提交用户工作恢复:cwd + branch 二元组)──
 * 冲突还原(undo)需要知道从哪个仓库的哪个分支切来;对象判等可防
 * A 仓库的冲突横幅在 B 仓库里复活 reset --hard 级还原。
 * 横幅的显隐由 status 轮询(冲突文件出现/消失)驱动重渲染,不依赖它本身。 */
let smartSwitchOrigin: { cwd: string; branch: string } | null = null;

export function setSmartSwitchOrigin(cwd: string, branch: string): void {
  smartSwitchOrigin = { cwd, branch };
}

export function getSmartSwitchOrigin(): { cwd: string; branch: string } | null {
  return smartSwitchOrigin;
}

export function clearSmartSwitchOrigin(): void {
  smartSwitchOrigin = null;
}

/* ── 多仓选中仓(workspace 维度记忆;app 运行期,不落盘)──
 * 按工作区 key:切 workspace 不串选;记忆指向已消失的仓时,
 * resolveRepoContext 会校验回退(repoContext.ts),此处不做失效清理。 */
const selectedRepoByWorkspace = new Map<string, string>();

export function setSelectedRepo(workspaceId: string, path: string): void {
  selectedRepoByWorkspace.set(workspaceId, path);
  emit();
}

export function getSelectedRepo(workspaceId: string): string | null {
  return selectedRepoByWorkspace.get(workspaceId) ?? null;
}
