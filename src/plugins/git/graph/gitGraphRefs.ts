/**
 * git graph ref 工具链 —— 自 gitGraph.ts 拆出(文件规模铁则)。
 * 装饰名归一 / ref→提交定位 / merge-base 推断 / 泳道克隆;常量(语义色、合成行
 * 哨兵 id)与共享类型(GitGraphCommit/GitGraphOptions/GraphLane/GraphColor)经
 * gitGraph.ts re-export,消费方契约不变。
 */

/** ref 语义色(消费 themes.css 的 --tmd-git-ref-*,dark/light 各有定值)。 */
export const GRAPH_REF_COLORS = {
  local: "var(--tmd-git-ref-local)",
  remote: "var(--tmd-git-ref-remote)",
  base: "var(--tmd-git-ref-base)",
} as const;

/** 合成行的哨兵 sha(真实 sha 不可能撞上)。 */
export const GIT_GRAPH_INCOMING_CHANGES_ID = "scm-graph-incoming-changes";
export const GIT_GRAPH_OUTGOING_CHANGES_ID = "scm-graph-outgoing-changes";

export type GraphColor = number | string;

/** 一条贯穿行的泳道:id = 该 lane 当前流向的提交 sha。 */
export type GraphLane = {
  id: string;
  color: GraphColor;
};

export type GitGraphCommit = {
  sha: string;
  parents: readonly string[];
  /** 指向本提交的 ref 装饰名(HEAD -> main / main / origin/main / tag: v1) */
  refs?: readonly string[];
};

export type GitGraphOptions = {
  /** 当前所在分支名(status.branch;detached 传空串则首行视为 head) */
  currentRef?: string;
  /** 上游分支名(如 origin/main) */
  remoteRef?: string;
  /** 对比基准分支(未用,留扩展) */
  baseRef?: string;
  /** 远端名(拼 remoteName/currentRef 参与远端色判定) */
  remoteName?: string;
  /** 是否插入 传出/传入 合成行 */
  showRemoteChangeMarkers?: boolean;
  ahead?: number;
  behind?: number;
  /** 已知 merge-base sha;缺省从可见提交集推断 */
  mergeBase?: string;
};

export function cloneLane(lane: GraphLane): GraphLane {
  return { ...lane };
}

/** 装饰名归一:剥掉 HEAD -> / tag: / refs/* 前缀,只剩可比较的名字。 */
export function normalizeRef(value: string) {
  let ref = value.trim();
  if (!ref) return "";
  if (ref.startsWith("HEAD -> ")) {
    ref = ref.slice("HEAD -> ".length).trim();
  }
  if (ref.startsWith("tag: ")) {
    ref = ref.slice("tag: ".length).trim();
  }
  if (ref.startsWith("refs/heads/")) {
    ref = ref.slice("refs/heads/".length);
  } else if (ref.startsWith("refs/remotes/")) {
    ref = ref.slice("refs/remotes/".length);
  } else if (ref.startsWith("refs/tags/")) {
    ref = ref.slice("refs/tags/".length);
  }
  return ref;
}

export function commitHasRef(commit: GitGraphCommit, ref: string) {
  const normalizedRef = normalizeRef(ref);
  if (!normalizedRef) return false;
  return (commit.refs ?? []).some((rawRef) => normalizeRef(rawRef) === normalizedRef);
}

/** 找到某 ref 指向的提交 sha;不在可见集内返回空串。 */
export function findCommitShaForRef(commits: readonly GitGraphCommit[], ref: string) {
  for (const commit of commits) {
    if (commitHasRef(commit, ref)) return commit.sha;
  }
  return "";
}

export function uniqueParents(parents: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawParent of parents) {
    const parent = rawParent.trim();
    if (!parent || seen.has(parent)) continue;
    seen.add(parent);
    result.push(parent);
  }
  return result;
}

/** merge-base 不在 options 时从可见提交集推断:首个双方可达的提交。 */
export function inferCommonAncestorSha(
  commits: readonly GitGraphCommit[],
  currentSha: string,
  remoteSha: string,
) {
  const commitBySha = new Map(commits.map((commit) => [commit.sha, commit]));

  function collectReachable(startSha: string) {
    const reachable = new Set<string>();
    const stack = [startSha];
    while (stack.length > 0) {
      const sha = stack.pop() ?? "";
      if (!sha || reachable.has(sha)) continue;
      reachable.add(sha);
      const commit = commitBySha.get(sha);
      if (!commit) continue;
      for (const parent of uniqueParents(commit.parents)) {
        stack.push(parent);
      }
    }
    return reachable;
  }

  const currentReachable = collectReachable(currentSha);
  const remoteReachable = collectReachable(remoteSha);
  for (const commit of commits) {
    if (currentReachable.has(commit.sha) && remoteReachable.has(commit.sha)) {
      return commit.sha;
    }
  }
  return "";
}
