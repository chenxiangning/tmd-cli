/**
 * DiffFlatList —— 差异面板平铺模式:F 终端风(spec 2026-09-05)。
 *
 * git status 原文短语三段分区(not staged / untracked / to be committed)+
 * `[x]modified:` 关键字列 + 右对齐暗色目录列 + 每文件 ±行数(低频 git_totals
 * 的逐文件 numstat,聚合恒等于逐项求和)+ hover 括号动作。
 * 配色全走 `--tmd-*` token —— 明暗/自定义 preset 零特判自动适配。
 * 树形模式不在此(见 DiffView 的 buildTree 分支)。
 *
 * 行交互语义(与后端「勾选先 stage 再提交全部 staged」契约对齐):
 * - st 段固定 [x](已暂存 = 必将进入提交),点击 = unstage;
 * - un/ut 段 [ ] 勾选 = 纳入提交;点行 = 中央区开 diff(wt 优先);
 * - 复合文件(staged && wt)两段各一行,与 git status 原生行为一致;
 * - 冲突行 — 禁勾禁操作,引导到幕布终端解决。
 */

import { useMemo, useState } from "react";
import type { GitFileStatus, GitTotals } from "@kernel/ipc";
import { STATUS_COLOR } from "./statusColor";

/** 状态字母 → 中文描述(hover 说明;行内只显示单字母标识)。 */
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

interface Props {
  files: GitFileStatus[];
  checked: ReadonlySet<string>;
  totals: GitTotals | null;
  onToggleCheck: (path: string) => void;
  onOpen: (file: GitFileStatus) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
}

interface Section {
  key: "un" | "ut" | "st";
  title: string;
  rows: GitFileStatus[];
}

export function DiffFlatList({
  files,
  checked,
  totals,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<Section["key"], boolean>>({
    un: false,
    ut: false,
    st: false,
  });
  const toggle = (key: Section["key"]) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  /* 三段派生:un = wt 侧 tracked(含 staged&&wt 复合的 wt 行);ut = untracked;st = staged */
  const sections = useMemo<Section[]>(
    () => [
      {
        key: "un",
        title: "未暂存变更",
        rows: files.filter((f) => f.wt && f.status !== "?"),
      },
      {
        key: "ut",
        title: "未跟踪文件",
        rows: files.filter((f) => f.status === "?"),
      },
      {
        key: "st",
        title: "待提交变更",
        rows: files.filter((f) => f.staged),
      },
    ],
    [files],
  );

  /* numstat 查询:key = `s:路径`(index 侧)/ `w:路径`(worktree 侧) */
  const numsByKey = useMemo(() => {
    const m = new Map<string, { i: number; d: number }>();
    for (const f of totals?.files ?? []) {
      m.set(`${f.staged ? "s" : "w"}:${f.path}`, { i: f.insertions, d: f.deletions });
    }
    return m;
  }, [totals]);

  const unPaths = sections[0].rows.map((f) => f.path);
  const utPaths = sections[1].rows.map((f) => f.path);
  const stPaths = sections[2].rows.map((f) => f.path);

  return (
    <div className="font-mono text-xs">
      {sections.map((sec) => {
        const isCollapsed = collapsed[sec.key];
        return (
          <div key={sec.key}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(sec.key)}
              onKeyDown={(e) => e.key === "Enter" && toggle(sec.key)}
              className="flex cursor-pointer select-none items-baseline gap-2 px-3 pb-0.5 pt-1.5 text-(--tmd-fg-muted)"
            >
              <span
                className={`text-[9px] text-(--tmd-fg-faint) ${isCollapsed ? "-rotate-90" : ""}`}
              >
                ▾
              </span>
              <span className="whitespace-nowrap">{sec.title}</span>
              {sec.rows.length > 0 && (
                <span className="text-(--tmd-fg-faint)">({sec.rows.length})</span>
              )}
              <span className="flex-1" />
              {!isCollapsed && sec.key === "un" && utPaths.length + unPaths.length > 0 && (
                <button
                  type="button"
                  title="git add 全部未暂存与未跟踪文件"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage([...unPaths, ...utPaths]);
                  }}
                  className="text-[11px] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
                >
                  (全部暂存)
                </button>
              )}
              {!isCollapsed && sec.key === "st" && stPaths.length > 0 && (
                <button
                  type="button"
                  title="git reset 全部已暂存文件"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage(stPaths);
                  }}
                  className="text-[11px] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
                >
                  (全部取消)
                </button>
              )}
            </div>
            {!isCollapsed &&
              (sec.rows.length === 0 ? (
                <div className="py-0.5 pl-3 text-[11px] text-(--tmd-fg-faint)">(nothing)</div>
              ) : (
                sec.rows.map((f) => (
                  <FRow
                    key={`${sec.key}:${f.path}`}
                    file={f}
                    side={sec.key}
                    checked={checked.has(f.path)}
                    nums={numsByKey.get(`${sec.key === "st" ? "s" : "w"}:${f.path}`)}
                    onToggleCheck={() => onToggleCheck(f.path)}
                    onOpen={() => onOpen(f)}
                    onStage={() => onStage([f.path])}
                    onUnstage={() => onUnstage([f.path])}
                    onDiscard={() => onDiscard([f.path])}
                  />
                ))
              ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── 文件行:[ ] [modified:] 名字 ←目录 +N −N / hover 括号动作 ── */

function FRow({
  file,
  side,
  checked,
  nums,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
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
          <span className="hidden items-baseline gap-2 group-hover:flex">
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
