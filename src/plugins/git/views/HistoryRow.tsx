/**
 * HistoryRow —— 历史视图行渲染(marker / 文件行 / 提交行)。
 * 从 HistoryView 拆出,纯呈现:展开态与回调由父级注入。
 * 行结构 = 泳道 SVG 左列 + 内容:提交行(摘要 + 作者头像 + sha + 相对时间)
 * / 合成标记行(传出的更改 / 传入的更改)/ 展开的文件行(图标 + 路径 + 状态字母)。
 */
import { Fragment } from "react";
import { stringHue } from "@kernel/colorHash";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import { resolveFileVisual } from "@kernel/fileVisual";
import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import type { GitCommitFile, GitLogEntry } from "@kernel/ipc";
import type { GraphRow } from "../graph/gitGraph";
import { GitGraphContinuationCell, GitGraphSvgCell } from "./GraphCells";
import { STATUS_COLOR } from "./statusColor";

export type HistoryRow =
  | { type: "commit"; commit: GitLogEntry; graph: GraphRow }
  | { type: "file"; commit: GitLogEntry; file: GitCommitFile; graph: GraphRow }
  | { type: "marker"; kind: "incoming-changes" | "outgoing-changes"; graph: GraphRow };

export const ROW_CLASS =
  "flex h-[22px] w-full min-w-0 select-none items-center gap-1 px-1.5 text-left text-xs";
/* h-10 钉 40px(--spacing 钉 4px 不随根字号):与 offsets 前缀和常数同源,
   uiFontSize≠16 时虚拟滚动不错位;溢出裁切是大字号下的取舍。 */
export const COMMIT_ROW_CLASS =
  "flex h-10 w-full min-w-0 select-none items-center gap-1 overflow-hidden px-1.5 py-1 text-left text-xs";

export interface HistoryRowItemProps {
  row: HistoryRow;
  upstream: string | null;
  /** 仅提交行用:展开态与文件清单状态 */
  expanded?: boolean;
  entry?: { loading?: boolean; error?: string | null; files?: GitCommitFile[] };
  onToggle?: (commit: GitLogEntry) => void;
  onOpenFile?: (commit: GitLogEntry, file: GitCommitFile) => void;
}

function MarkerRow({ row, upstream }: { row: Extract<HistoryRow, { type: "marker" }>; upstream: string | null }) {
  const label = row.kind === "outgoing-changes" ? t("传出的更改") : t("传入的更改");
  return (
    <div className={ROW_CLASS} title={upstream ? `${label} ${upstream}` : label}>
      <GitGraphSvgCell row={row.graph} />
      <span className="min-w-0 flex-1 truncate font-medium text-(--tmd-fg-muted)">{label}</span>
    </div>
  );
}

function FileRow({
  row,
  onOpenFile,
}: {
  row: Extract<HistoryRow, { type: "file" }>;
  onOpenFile?: HistoryRowItemProps["onOpenFile"];
}) {
  const name = row.file.path.split("/").pop() ?? row.file.path;
  const dir = row.file.path.includes("/")
    ? row.file.path.slice(0, row.file.path.lastIndexOf("/"))
    : "";
  const icon = resolveFileVisual(name, false);
  return (
    <button
      type="button"
      className={`${ROW_CLASS} cursor-pointer hover:bg-(--tmd-bg-hover)`}
      title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
      onClick={() => onOpenFile?.(row.commit, row.file)}
    >
      <GitGraphContinuationCell row={row.graph} />
      <span
        className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: icon.svgHtml }}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{name}</span>
        {dir && <span className="ml-1 text-[0.625rem] text-(--tmd-fg-faint)">{dir}</span>}
      </span>
      <span className={`w-3 shrink-0 text-center font-semibold ${STATUS_COLOR[row.file.status] ?? ""}`}>
        {row.file.status}
      </span>
    </button>
  );
}

function CommitRow({
  row,
  expanded,
  entry,
  onToggle,
}: {
  row: Extract<HistoryRow, { type: "commit" }>;
  expanded: boolean;
  entry: HistoryRowItemProps["entry"];
  onToggle?: HistoryRowItemProps["onToggle"];
}) {
  return (
    <Fragment key={`commit:${row.commit.longSha}`}>
      <button
        type="button"
        aria-expanded={expanded}
        title={`${row.commit.authorName} <${row.commit.authorEmail}>\n${formatAbsolute(
          row.commit.authorWhen * 1000,
        )} · ${row.commit.shortSha}`}
        onClick={() => onToggle?.(row.commit)}
        className={`${COMMIT_ROW_CLASS} cursor-pointer hover:bg-(--tmd-bg-hover) ${
          expanded ? "bg-(--tmd-bg-active)" : ""
        }`}
      >
        <GitGraphSvgCell row={row.graph} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {row.commit.summary || t("(空消息)")}
          </span>
          <span className="flex items-center gap-1.5 text-[0.625rem] leading-4 text-(--tmd-fg-faint)">
            <span className="font-mono">{row.commit.shortSha}</span>
            <span
              className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[0.5rem] font-semibold uppercase"
              style={{
                color: `color-mix(in srgb, hsl(${stringHue(row.commit.authorEmail)} 60% 62%) 70%, var(--tmd-fg))`,
                background: `hsl(${stringHue(row.commit.authorEmail)} 50% 55% / 0.18)`,
              }}
              aria-hidden
            >
              {row.commit.authorName.slice(0, 1)}
            </span>
            <span className="min-w-0 truncate">{row.commit.authorName}</span>
            <span className="shrink-0 tabular-nums">
              {formatRelativeTime(row.commit.authorWhen * 1000)}
            </span>
          </span>
        </span>
      </button>
      {/* 展开区占位:清单加载中/失败给一行反馈,成功后由 rows 出文件行 */}
      {expanded && entry?.loading && (
        <div className={ROW_CLASS} title={t("加载改动文件")}>
          <GitGraphContinuationCell row={row.graph} />
          <CircleNotch className="h-[0.75rem] w-[0.75rem] shrink-0 animate-spin text-(--tmd-fg-faint)" />
          <span className="text-(--tmd-fg-faint)">{t("加载中…")}</span>
        </div>
      )}
      {expanded && entry?.error && (
        <div className={ROW_CLASS} title={entry.error}>
          <GitGraphContinuationCell row={row.graph} />
          <span className="truncate text-(--tmd-diff-removed)">
            {entry.error.replace(/^E_[A-Z_]+:\s*/, "")}
          </span>
        </div>
      )}
      {/* 空提交:清单已载且为空,给一行明示而非无声收场 */}
      {expanded && entry && !entry.loading && !entry.error && (entry.files?.length ?? 0) === 0 && (
        <div className={ROW_CLASS}>
          <GitGraphContinuationCell row={row.graph} />
          <span className="text-(--tmd-fg-faint)">{t("无改动文件")}</span>
        </div>
      )}
    </Fragment>
  );
}

export function HistoryRowItem(props: HistoryRowItemProps) {
  const { row } = props;
  if (row.type === "marker") return <MarkerRow row={row} upstream={props.upstream} />;
  if (row.type === "file") return <FileRow row={row} onOpenFile={props.onOpenFile} />;
  return (
    <CommitRow row={row} expanded={props.expanded ?? false} entry={props.entry} onToggle={props.onToggle} />
  );
}
