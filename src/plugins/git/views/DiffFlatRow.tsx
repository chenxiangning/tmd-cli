/**
 * DiffFlatList 文件行 —— 自 DiffFlatList.tsx 拆出(文件规模铁则)。
 * FRow:`[x]`/状态字母徽标/文件名/右对齐暗色目录列/±行数与 hover 括号动作
 * 互斥换位;状态描述表(STATUS_DESC)与徽标字母表(BADGE)随行迁移。
 */

import type { GitFileStatus } from "@kernel/ipc";
import { STATUS_COLOR } from "./statusColor";
import { FileOpenActions } from "./FileRowActions";

const STATUS_DESC: Record<GitFileStatus["status"], string> = {
  M: "已修改 (modified)",
  A: "新增 (new file)",
  D: "已删除 (deleted)",
  R: "重命名 (renamed)",
  T: "类型变更 (typechange)",
  C: "双方修改,冲突 (both modified)",
  "?": "未跟踪 (untracked)",
};

/** 状态标识字母(untracked 记 U,与聚合行/历史视图口径一致)。 */
const BADGE: Record<GitFileStatus["status"], string> = {
  M: "M",
  A: "A",
  D: "D",
  R: "R",
  T: "T",
  C: "C",
  "?": "U",
};

const fmt = (n: number): string => n.toLocaleString("en-US");

/** [文件名, 目录](根文件目录为空串)。 */
function splitPath(p: string): [string, string] {
  const i = p.lastIndexOf("/");
  return i < 0 ? [p, ""] : [p.slice(i + 1), p.slice(0, i)];
}

export function FRow({
  file,
  side,
  checked,
  nums,
  cwd,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
  cwd: string;
  /** 行所在分区:"st" = index 侧视图(点击 [x] = unstage);"un"/"ut" = 工作区侧视图 */
  side: "un" | "ut" | "st";
  checked: boolean;
  nums: { i: number; d: number } | undefined;
  onToggleCheck: () => void;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const conflict = file.status === "C";
  const stagedRow = side === "st";
  const [name, dir] = splitPath(file.path);
  const dirText = file.oldPath
    ? `← ${splitPath(file.oldPath)[1] ?? ""}/`
    : dir
      ? `${dir}/`
      : "";
  const numsBlank = !nums || (nums.i === 0 && nums.d === 0);
  /* 放弃仅对常规修改开放:rename/deleted 的还原语义含糊,冲突已禁,untracked 无处可还 */
  const canDiscard = side === "un" && (file.status === "M" || file.status === "T");

  return (
    <div
      onClick={onOpen}
      title={`${file.path} —— 点击在中间打开 diff${conflict ? " · 冲突,请先到幕布解决" : ""}`}
      className="group flex h-6 cursor-pointer select-none items-center gap-2 whitespace-nowrap pl-3 pr-3 hover:bg-(--tmd-bg-hover)"
    >
      <button
        type="button"
        disabled={conflict}
        onClick={(e) => {
          e.stopPropagation();
          if (stagedRow) onUnstage();
          else onToggleCheck();
        }}
        title={
          conflict
            ? "冲突文件:请到幕布终端解决后提交"
            : stagedRow
              ? "取消暂存(git reset)"
              : checked
                ? "移出本次提交"
                : "纳入本次提交"
        }
        className={`w-[26px] shrink-0 text-left ${conflict ? "text-(--tmd-fg-faint) opacity-60" : stagedRow || checked ? "text-(--tmd-fg)" : "text-(--tmd-fg-muted)"}`}
      >
        {conflict ? "—" : stagedRow || checked ? "[x]" : "[ ]"}
      </button>
      {/* 状态标识:单字母着色(替代长关键字短语,untracked 也有 U 可看) */}
      <span
        title={STATUS_DESC[file.status]}
        className={`w-[14px] shrink-0 text-center font-semibold ${STATUS_COLOR[file.status] ?? ""}`}
      >
        {BADGE[file.status]}
      </span>
      <span className="min-w-0 flex-1 truncate text-(--tmd-fg)">{name}</span>
      <span
        dir="rtl"
        className="max-w-[38%] shrink-0 truncate text-right text-[11px] text-(--tmd-fg-faint)"
      >
        {dirText}
      </span>
      {/* 数字位与动作位互斥显示(hover 换位,同原型):宽随内容,截断兜底在 dir 列 */}
      {conflict ? (
        <span className="shrink-0 text-[11px] text-(--tmd-diff-removed)">冲突</span>
      ) : (
        <span className="shrink-0 text-[11px] tabular-nums">
          <span className={numsBlank ? "group-hover:invisible" : "group-hover:hidden"}>
            <span className="text-(--tmd-diff-inserted)">+{nums ? fmt(nums.i) : 0}</span>{" "}
            <span className="text-(--tmd-diff-removed)">−{nums ? fmt(nums.d) : 0}</span>
          </span>
          <span className="hidden items-center gap-2 group-hover:flex">
            <FileOpenActions cwd={cwd} file={file} />
            {stagedRow ? (
              <button
                type="button"
                title="取消暂存(git reset)"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnstage();
                }}
                className="text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
              >
                (取消暂存)
              </button>
            ) : (
              <button
                type="button"
                title="暂存(git add)"
                onClick={(e) => {
                  e.stopPropagation();
                  onStage();
                }}
                className="text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
              >
                (暂存)
              </button>
            )}
            {canDiscard && (
              <button
                type="button"
                title="放弃工作区改动(还原到暂存区;不可恢复)"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard();
                }}
                className="text-(--tmd-fg-faint) hover:text-(--tmd-diff-removed) hover:underline hover:underline-offset-2"
              >
                (放弃)
              </button>
            )}
          </span>
        </span>
      )}
    </div>
  );
}
