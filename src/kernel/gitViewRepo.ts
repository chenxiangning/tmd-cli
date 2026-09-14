/**
 * git 面板当前查看的仓 —— 跨层契约(2026-09-15):GitPanel 把多仓解析后的
 * 选中仓根写进来,顶栏分支 label(app-shell GitBranchLabel)读。多仓工作区
 * 根目录本身常非仓,label 只有跟随面板正在查看的仓才有正确分支可显。
 *
 * cwd null = 面板未解析(guide 档未点选/面板未挂),消费侧回退工作区根
 * (单仓工作区根即仓,原语义不变)。对齐 filePanel 的 kernel store 先例
 * (createSubscribable + useStore;快照不可变,同值不换引用)。
 */

import { createSubscribable } from "./subscribable";

export interface GitViewRepo {
  /** 所属工作区 id:消费侧与活动工作区核对,防切工作区串显。 */
  workspaceId: string;
  /** 选中仓根 cwd;null = 面板已挂但未解析出仓(guide 档未点选)。 */
  cwd: string | null;
}

const store = createSubscribable<GitViewRepo | null>(null);

/** GitPanel 解析态变更时调用;同值幂等,不换快照引用不通知。 */
export function setGitViewRepo(next: GitViewRepo): void {
  const prev = store.snapshot;
  if (prev && prev.workspaceId === next.workspaceId && prev.cwd === next.cwd) return;
  store.commit(next);
}

/** 读当前快照(测试/非 React 场景;React 侧用 useGitViewRepo)。 */
export function getGitViewRepo(): GitViewRepo | null {
  return store.snapshot;
}

/** 顶栏 label 订阅;尚无写入(null)时消费侧走工作区根回退。 */
export function useGitViewRepo(): GitViewRepo | null {
  return store.useStore();
}

/** label 取数源:面板选中仓(工作区匹配且已解析 cwd)优先,否则回退工作区根
 *  (单仓工作区根即仓;多仓根非仓时由 label 侧的 NotARepo 拒绝分支隐藏)。 */
export function resolveBranchCwd(
  view: GitViewRepo | null,
  workspaceId: string,
  root: string,
): string {
  return view && view.workspaceId === workspaceId && view.cwd ? view.cwd : root;
}
