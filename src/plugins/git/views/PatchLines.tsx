/**
 * diff 正文渲染:单栏(unified)= 自绘经典红绿;双栏(split)= react-diff-view
 * split 视图(parseDiff 解析原生 git patch,自带左右行对位与占位),主题经
 * CSS 变量映射到 tmd tokens(见 git-panel.css 的 .git-diff-rdv 段)。
 */
import { useMemo } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import type { GitDiffMode } from "@kernel/settings";
import type { PatchRow } from "./patchModel";
import { parsePatch } from "./patchModel";
import { useGitPanelState } from "../panelStore";

/** 行底色/字色:单栏整行用(经典红绿)。 */
const ROW_CLS: Record<string, string> = {
  hunk: "my-1 border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[0.625rem] text-(--tmd-accent)",
  add: "bg-(color:--tmd-diff-inserted)/12 text-(--tmd-diff-inserted)",
  del: "bg-(color:--tmd-diff-removed)/12 text-(--tmd-diff-removed)",
  ctx: "text-(--tmd-fg-muted)",
  meta: "italic text-(--tmd-fg-faint)",
};

const GUTTER_CLS =
  "min-w-[2.5rem] shrink-0 select-none pr-1.5 text-right tabular-nums text-(--tmd-fg-faint)";


/** diff 行稳定 key:种类 + 旧/新行号 + 内容。 */
function patchRowKey(row: {
  kind: string;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}): string {
  return `${row.kind}:${row.oldLine ?? "-"}:${row.newLine ?? "-"}:${row.text}`;
}

/** 单栏行号槽:旧/新两列,无号留空保对齐。 */
function Gutter({ oldLine, newLine }: { oldLine: number | null; newLine: number | null }) {
  return (
    <>
      <span className={GUTTER_CLS}>{oldLine ?? ""}</span>
      <span className={`${GUTTER_CLS} pl-1.5 pr-0`}>{newLine ?? ""}</span>
    </>
  );
}

function UnifiedRow({ row, wrap }: { row: PatchRow; wrap: boolean }) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  const content = wrap ? "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2" : "min-w-0 flex-1 shrink-0 whitespace-pre pl-2";
  return (
    <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      <span className={content}>{row.text}</span>
    </div>
  );
}

/** 双栏:原生 patch → react-diff-view。parseDiff 需要文件头,补一段最小头。 */
function SplitDiff({ text, wrap }: { text: string; wrap: boolean }) {
  const file = useMemo(() => {
    const withHeader = text.startsWith("diff --git") ? text : `diff --git a/f a/f\n--- a/f\n+++ b/f\n${text}`;
    return parseDiff(withHeader, { nearbySequences: "zip" })[0];
  }, [text]);
  return (
    <div className={`git-diff-rdv ${wrap ? "git-diff-rdv-wrap" : ""}`}>
      <Diff viewType="split" diffType={file.type} hunks={file.hunks} gutterType="default">
        {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
      </Diff>
    </div>
  );
}

export function PatchLines({
  text,
  className = "max-h-72",
  mode = "unified",
}: {
  text: string;
  className?: string;
  mode?: GitDiffMode;
}) {
  const { diffWrap } = useGitPanelState();
  const rows = useMemo(() => parsePatch(text), [text]);
  if (mode === "split") {
    /* 双栏交给 react-diff-view;横向滚动整体共享(对位精确优先)。 */
    return (
      <div className={`${className} overflow-auto py-1`}>
        <SplitDiff text={text} wrap={diffWrap} />
      </div>
    );
  }
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[0.6875rem] leading-tight`}>
      {rows.map((row) => (
        <UnifiedRow key={patchRowKey(row)} row={row} wrap={diffWrap} />
      ))}
    </pre>
  );
}
