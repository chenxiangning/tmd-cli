/**
 * git graph 泳道布局 —— 历史视图 Graph 化的纯算法层(无 IO、无 React)。
 *
 * 输入按「新→旧」排好的提交序列(revwalk 顺序),输出每行的泳道格:
 * 圆点所在列/颜色 + 上下行连线(输入/输出 lane),供 SVG 单元格渲染。
 * 头部 ref(本地分支/远端/base)给固定语义色,其余泳道从 5 色调色板循环取色。
 * 另会按 ahead/behind 插入「传出的更改 / 传入的更改」合成行(VS Code SCM Graph 同款)。
 */

import {
  cloneLane,
  findCommitShaForRef,
  normalizeRef,
  uniqueParents,
  GRAPH_REF_COLORS,
  type GitGraphCommit,
  type GitGraphOptions,
  type GraphColor,
  type GraphLane,
} from "./gitGraphRefs";
import { addIncomingOutgoingChangeRows } from "./gitGraphChangeRows";

// 拆出后保持 ./gitGraph 导出契约(消费方:GraphCells / HistoryView / gitGraph.test)。
export {
  GRAPH_REF_COLORS,
  GIT_GRAPH_INCOMING_CHANGES_ID,
  GIT_GRAPH_OUTGOING_CHANGES_ID,
} from "./gitGraphRefs";
export type { GraphColor } from "./gitGraphRefs";

/** 泳道调色板(VS Code SCM Graph 同款五色)。 */
export const GRAPH_COLORS = ["#ffb000", "#dc267f", "#994f00", "#40b0a6", "#b66dff"];

type GraphRowKind = "commit" | "incoming-changes" | "outgoing-changes";

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
