/**
 * DiffFlatList 文件行 —— 自 DiffFlatList.tsx 拆出(文件规模铁则)。
 * FRow:`[x]`/状态字母徽标/文件名/右对齐暗色目录列/±行数与 hover 括号动作
 * 互斥换位;状态描述表(STATUS_DESC)与徽标字母表(BADGE)随行迁移。
 * 勾选框留本文件,hover 动作簇拆至 DiffRowActions(降分支)。
 */

import { t } from "@kernel/i18n";
import type { GitFileStatus } from "@kernel/ipc";
import { STATUS_COLOR } from "./statusColor";
import { RowHoverActions } from "./DiffRowActions";

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

/** 行首勾选框:冲突禁用记 —;staged 侧点击 = 取消暂存,工作区侧 = 勾选切换。 */
function RowCheckbox({
  conflict,
  stagedRow,
  checked,
  onToggleCheck,
  onUnstage,
}: {
  conflict: boolean;
  stagedRow: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onUnstage: () => void;
}) {
  return (
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
          ? t("冲突文件:请到幕布终端解决后提交")
          : stagedRow
            ? t("取消暂存(git reset)")
            : checked
              ? t("移出本次提交")
              : t("纳入本次提交")
      }
      className={`w-[26px] shrink-0 text-left ${conflict ? "text-(--tmd-fg-faint) opacity-60" : stagedRow || checked ? "text-(--tmd-fg)" : "text-(--tmd-fg-muted)"}`}
    >
      {conflict ? "—" : stagedRow || checked ? "[x]" : "[ ]"}
    </button>
  );
}

/** 目录列文案:rename 行显示旧路径目录(← 前缀),否则原目录;根文件为空(降分支拆件)。 */
function dirLabel(file: GitFileStatus, dir: string): string {
  if (file.oldPath) return `← ${splitPath(file.oldPath)[1] ?? ""}/`;
  return dir ? `${dir}/` : "";
}

/** 行悬浮文案:冲突行附「先解决」提示(降分支拆件)。 */
function rowTitle(file: GitFileStatus, conflict: boolean): string {
  return conflict
    ? t("{path} —— 点击在中间打开 diff · 冲突,请先到幕布解决", { path: file.path })
    : t("{path} —— 点击在中间打开 diff", { path: file.path });
}

/** 行尾:冲突标签或「±数字 ↔ hover 动作」互斥换位簇(降分支拆件);
    数字位与动作位 hover 换位(同原型),宽随内容,截断兜底在 dir 列。 */
function RowTrailer({
  conflict,
  stagedRow,
  canDiscard,
  canDelete,
  cwd,
  nums,
  file,
  onStage,
  onUnstage,
  onDiscard,
  onDelete,
}: {
  conflict: boolean;
  stagedRow: boolean;
  canDiscard: boolean;
  canDelete: boolean;
  cwd: string;
  nums: { i: number; d: number } | undefined;
  file: GitFileStatus;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}) {
  const numsBlank = !nums || (nums.i === 0 && nums.d === 0);
  return conflict ? (
    <span className="shrink-0 text-[0.6875rem] text-(--tmd-diff-removed)">{t("冲突")}</span>
  ) : (
    <span className="shrink-0 text-[0.6875rem] tabular-nums">
      <span className={numsBlank ? "group-hover:invisible" : "group-hover:hidden"}>
        <span className="text-(--tmd-diff-inserted)">+{nums ? fmt(nums.i) : 0}</span>{" "}
        <span className="text-(--tmd-diff-removed)">−{nums ? fmt(nums.d) : 0}</span>
      </span>
      <RowHoverActions
        file={file}
        stagedRow={stagedRow}
        canDiscard={canDiscard}
        canDelete={canDelete}
        cwd={cwd}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
        onDelete={onDelete}
      />
    </span>
  );
}

export function FRow({
  file,
  side,
  checked,
  nums,
  cwd,
  mrow,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
  onDelete,
}: {
  file: GitFileStatus;
  cwd: string;
  /** 行所在分区:"st" = index 侧视图(点击 [x] = unstage);"un"/"ut" = 工作区侧视图 */
  side: "un" | "ut" | "st";
  checked: boolean;
  nums: { i: number; d: number } | undefined;
  /** 拖选锚点下标(未暂存/未跟踪可勾选行专用;待提交段与冲突行不参选) */
  mrow?: number;
  onToggleCheck: () => void;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}) {
  const conflict = file.status === "C";
  const stagedRow = side === "st";
  const [name, dir] = splitPath(file.path);
  /* 放弃仅对常规修改开放:rename/deleted 的还原语义含糊,冲突已禁,untracked 无处可还 */
  const canDiscard = side === "un" && (file.status === "M" || file.status === "T");
  const canDelete = side === "ut";

  return (
    <div
      onClick={onOpen}
      role="presentation"
      data-mrow={mrow}
      title={rowTitle(file, conflict)}
      className="group flex h-6 cursor-pointer select-none items-center gap-2 whitespace-nowrap pl-3 pr-3 hover:bg-(--tmd-bg-hover)"
    >
      <RowCheckbox
        conflict={conflict}
        stagedRow={stagedRow}
        checked={checked}
        onToggleCheck={onToggleCheck}
        onUnstage={onUnstage}
      />
      {/* 状态标识:单字母着色(替代长关键字短语,untracked 也有 U 可看) */}
      <span
        title={t(STATUS_DESC[file.status])}
        className={`w-[14px] shrink-0 text-center font-semibold ${STATUS_COLOR[file.status] ?? ""}`}
      >
        {BADGE[file.status]}
      </span>
      <span className="min-w-0 flex-1 truncate text-(--tmd-fg)">{name}</span>
      <span
        dir="rtl"
        className="max-w-[38%] shrink-0 truncate text-right text-[0.6875rem] text-(--tmd-fg-faint)"
      >
        {dirLabel(file, dir)}
      </span>
      {/* 数字位与动作位互斥显示(hover 换位,同原型):宽随内容,截断兜底在 dir 列 */}
      <RowTrailer
        conflict={conflict}
        stagedRow={stagedRow}
        canDiscard={canDiscard}
        canDelete={canDelete}
        cwd={cwd}
        nums={nums}
        file={file}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
        onDelete={onDelete}
      />
    </div>
  );
}
