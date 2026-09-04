/**
 * git graph 泳道布局 —— 历史视图 Graph 化的纯算法层(无 IO、无 React)。
 *
 * 输入按「新→旧」排好的提交序列(revwalk 顺序),输出每行的泳道格:
 * 圆点所在列/颜色 + 上下行连线(输入/输出 lane),供 SVG 单元格渲染。
 * 头部 ref(本地分支/远端/base)给固定语义色,其余泳道从 5 色调色板循环取色。
 * 另会按 ahead/behind 插入「传出的更改 / 传入的更改」合成行(VS Code SCM Graph 同款)。
 */

/** 泳道调色板(VS Code SCM Graph 同款五色)。 */
export const GRAPH_COLORS = ["#ffb000", "#dc267f", "#994f00", "#40b0a6", "#b66dff"];

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
type GraphRowKind = "commit" | "incoming-changes" | "outgoing-changes";

/** 一条贯穿行的泳道:id = 该 lane 当前流向的提交 sha。 */
type GraphLane = {
  id: string;
  color: GraphColor;
};

export type GraphRow = {
  kind: GraphRowKind;
  sha: string;
  parents: string[];
  /** 圆点所在列 */
  commitCol: number;
  commitColor: GraphColor;
  /** 本行上缘的入线(来自上一行的输出) */
  inputLanes: GraphLane[];
  /** 本行下缘的出线(交给下一行的输入) */
  outputLanes: GraphLane[];
  isHead: boolean;
  isMerge: boolean;
};

type GitGraphCommit = {
  sha: string;
  parents: readonly string[];
  /** 指向本提交的 ref 装饰名(HEAD -> main / main / origin/main / tag: v1) */
  refs?: readonly string[];
};

type GitGraphOptions = {
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

function cloneLane(lane: GraphLane): GraphLane {
  return { ...lane };
}

/** 装饰名归一:剥掉 HEAD -> / tag: / refs/* 前缀,只剩可比较的名字。 */
function normalizeRef(value: string) {
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

/** ref 名 → 语义色的判定表(当前分支=local,上游=remote,base=base)。 */
function createRefColorMap(options: GitGraphOptions) {
  const map = new Map<string, GraphColor>();
  const currentRef = normalizeRef(options.currentRef ?? "");
  const remoteRef = normalizeRef(options.remoteRef ?? "");
  const baseRef = normalizeRef(options.baseRef ?? "");
  const remoteName = normalizeRef(options.remoteName ?? "");

  if (currentRef) {
    map.set(currentRef, GRAPH_REF_COLORS.local);
  }
  if (remoteRef) {
    map.set(remoteRef, GRAPH_REF_COLORS.remote);
  }
  if (remoteName && currentRef) {
    map.set(`${remoteName}/${currentRef}`, GRAPH_REF_COLORS.remote);
  }
  if (baseRef) {
    map.set(baseRef, GRAPH_REF_COLORS.base);
  }
  return map;
}

/** 提交携带的第一条有语义色的 ref 决定该提交的着色。 */
function labelColorForCommit(
  commit: GitGraphCommit | undefined,
  refColorMap: Map<string, GraphColor>,
): GraphColor | undefined {
  for (const rawRef of commit?.refs ?? []) {
    const color = refColorMap.get(normalizeRef(rawRef));
    if (color !== undefined) return color;
  }
  return undefined;
}

function commitHasRef(commit: GitGraphCommit, ref: string) {
  const normalizedRef = normalizeRef(ref);
  if (!normalizedRef) return false;
  return (commit.refs ?? []).some((rawRef) => normalizeRef(rawRef) === normalizedRef);
}

/** 找到某 ref 指向的提交 sha;不在可见集内返回空串。 */
function findCommitShaForRef(commits: readonly GitGraphCommit[], ref: string) {
  for (const commit of commits) {
    if (commitHasRef(commit, ref)) return commit.sha;
  }
  return "";
}

function uniqueParents(parents: readonly string[]) {
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
function inferCommonAncestorSha(
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

function findLastGraphRowIndex(rows: readonly GraphRow[], predicate: (row: GraphRow) => boolean) {
  for (let index = rows.length - 1; index >= 0; index--) {
    if (predicate(rows[index])) return index;
  }
  return -1;
}

function createSyntheticGraphRow({
  kind,
  sha,
  parents,
  inputLanes,
  outputLanes,
  color,
}: {
  kind: "incoming-changes" | "outgoing-changes";
  sha: string;
  parents: string[];
  inputLanes: GraphLane[];
  outputLanes: GraphLane[];
  color: GraphColor;
}): GraphRow {
  const inputIndex = inputLanes.findIndex((lane) => lane.id === sha);
  return {
    kind,
    sha,
    parents,
    commitCol: inputIndex >= 0 ? inputIndex : inputLanes.length,
    commitColor: color,
    inputLanes,
    outputLanes,
    isHead: false,
    isMerge: false,
  };
}

function shouldShowChangeMarker(count: number | undefined) {
  return count === undefined || count > 0;
}

/** 在 rows 中插入 传入/传出 合成行,并把被穿越 lane 改名为哨兵 id。 */
function addIncomingOutgoingChangeRows(
  rows: GraphRow[],
  commits: readonly GitGraphCommit[],
  options: GitGraphOptions,
) {
  const currentSha = findCommitShaForRef(commits, options.currentRef ?? "");
  const remoteSha = findCommitShaForRef(commits, options.remoteRef ?? "");
  if (!currentSha || !remoteSha || currentSha === remoteSha) return;

  const mergeBase =
    options.mergeBase?.trim() || inferCommonAncestorSha(commits, currentSha, remoteSha);
  if (!mergeBase) return;

  // 传入(behind>0):在 merge-base 提交行之前落一个合成行
  if (
    shouldShowChangeMarker(options.behind) &&
    remoteSha !== mergeBase &&
    rows.some((row) => row.sha === mergeBase)
  ) {
    const beforeIndex = findLastGraphRowIndex(rows, (row) =>
      row.outputLanes.some((lane) => lane.id === mergeBase),
    );
    const afterIndex = rows.findIndex((row) => row.kind === "commit" && row.sha === mergeBase);

    if (beforeIndex !== -1 && afterIndex !== -1) {
      const incomingChangeMerged =
        rows[beforeIndex].parents.length === 2 && rows[beforeIndex].parents.includes(mergeBase);

      if (!incomingChangeMerged) {
        rows[beforeIndex] = {
          ...rows[beforeIndex],
          inputLanes: rows[beforeIndex].inputLanes.map((lane) =>
            lane.id === mergeBase && lane.color === GRAPH_REF_COLORS.remote
              ? { ...lane, id: GIT_GRAPH_INCOMING_CHANGES_ID }
              : cloneLane(lane),
          ),
          outputLanes: rows[beforeIndex].outputLanes.map((lane) =>
            lane.id === mergeBase && lane.color === GRAPH_REF_COLORS.remote
              ? { ...lane, id: GIT_GRAPH_INCOMING_CHANGES_ID }
              : cloneLane(lane),
          ),
        };

        rows.splice(
          afterIndex,
          0,
          createSyntheticGraphRow({
            kind: "incoming-changes",
            sha: GIT_GRAPH_INCOMING_CHANGES_ID,
            parents: [mergeBase],
            inputLanes: rows[beforeIndex].outputLanes.map(cloneLane),
            outputLanes: rows[afterIndex].inputLanes.map(cloneLane),
            color: GRAPH_REF_COLORS.remote,
          }),
        );
      }
    }
  }

  // 传出(ahead>0):在当前分支 tip 行之前落一个合成行
  if (shouldShowChangeMarker(options.ahead) && currentSha !== mergeBase) {
    const currentIndex = rows.findIndex((row) => row.kind === "commit" && row.sha === currentSha);
    if (currentIndex !== -1) {
      const inputLanes = rows[currentIndex].inputLanes.map(cloneLane);
      rows.splice(
        currentIndex,
        0,
        createSyntheticGraphRow({
          kind: "outgoing-changes",
          sha: GIT_GRAPH_OUTGOING_CHANGES_ID,
          parents: [currentSha],
          inputLanes,
          outputLanes: [
            ...inputLanes.map(cloneLane),
            { id: currentSha, color: GRAPH_REF_COLORS.local },
          ],
          color: GRAPH_REF_COLORS.local,
        }),
      );
      rows[currentIndex + 1] = {
        ...rows[currentIndex + 1],
        inputLanes: [
          ...rows[currentIndex + 1].inputLanes.map(cloneLane),
          { id: currentSha, color: GRAPH_REF_COLORS.local },
        ],
      };
    }
  }
}

function graphColumnCount(row: GraphRow) {
  return Math.max(row.inputLanes.length, row.outputLanes.length, row.commitCol + 1, 1);
}

function calculateMaxCols(rows: readonly GraphRow[]) {
  return rows.reduce((maxCols, row) => Math.max(maxCols, graphColumnCount(row)), 0);
}

export function computeGitGraph(
  commits: readonly GitGraphCommit[],
  options: GitGraphOptions = {},
): {
  rows: GraphRow[];
  maxCols: number;
} {
  if (commits.length === 0) return { rows: [], maxCols: 0 };

  const rows: GraphRow[] = [];
  const commitBySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const refColorMap = createRefColorMap(options);
  const currentHeadSha = findCommitShaForRef(commits, options.currentRef ?? "");
  let nextColor = -1;
  let previousOutputLanes: GraphLane[] = [];
  let maxCols = 1;

  function allocColor(): number {
    nextColor = (nextColor + 1) % GRAPH_COLORS.length;
    return nextColor;
  }

  for (let index = 0; index < commits.length; index++) {
    const commit = commits[index];
    const parents = uniqueParents(commit.parents);
    const inputLanes = previousOutputLanes.map(cloneLane);
    const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.sha);
    const commitCol = inputIndex >= 0 ? inputIndex : inputLanes.length;
    const labelColor = labelColorForCommit(commit, refColorMap);
    const commitColor =
      inputIndex >= 0 ? inputLanes[inputIndex].color : (labelColor ?? allocColor());
    const outputLanes: GraphLane[] = [];

    if (parents.length > 0) {
      let firstParentAdded = false;
      for (const lane of inputLanes) {
        if (lane.id === commit.sha) {
          if (!firstParentAdded) {
            outputLanes.push({ id: parents[0], color: labelColor ?? commitColor });
            firstParentAdded = true;
          }
          continue;
        }
        outputLanes.push(cloneLane(lane));
      }

      if (!firstParentAdded) {
        outputLanes.push({ id: parents[0], color: labelColor ?? commitColor });
      }

      // 其余父提交:新开泳道(merge 的第二父从本行分支出去)
      for (let parentIndex = 1; parentIndex < parents.length; parentIndex++) {
        const parent = parents[parentIndex];
        outputLanes.push({
          id: parent,
          color: labelColorForCommit(commitBySha.get(parent), refColorMap) ?? allocColor(),
        });
      }
    }

    maxCols = Math.max(maxCols, inputLanes.length, outputLanes.length, commitCol + 1);
    rows.push({
      kind: "commit",
      sha: commit.sha,
      parents,
      commitCol,
      commitColor,
      inputLanes,
      outputLanes,
      isHead: currentHeadSha ? commit.sha === currentHeadSha : index === 0,
      isMerge: parents.length > 1,
    });
    previousOutputLanes = outputLanes;
  }

  if (options.showRemoteChangeMarkers) {
    addIncomingOutgoingChangeRows(rows, commits, options);
    maxCols = Math.max(maxCols, calculateMaxCols(rows));
  }

  return { rows, maxCols };
}
