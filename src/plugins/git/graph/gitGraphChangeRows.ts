/**
 * git graph 传入/传出合成行 —— 自 gitGraph.ts 拆出(文件规模铁则)。
 * ahead/behind 非零时在 merge-base / 当前 tip 行附近插入「传出的更改 / 传入的更改」
 * 合成行(VS Code SCM Graph 同款),被穿越 lane 改名为哨兵 id。
 */

import type { GraphRow } from "./gitGraph";
import {
  cloneLane,
  findCommitShaForRef,
  inferCommonAncestorSha,
  GRAPH_REF_COLORS,
  GIT_GRAPH_INCOMING_CHANGES_ID,
  GIT_GRAPH_OUTGOING_CHANGES_ID,
  type GitGraphCommit,
  type GitGraphOptions,
  type GraphColor,
  type GraphLane,
} from "./gitGraphRefs";

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
export function addIncomingOutgoingChangeRows(
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
