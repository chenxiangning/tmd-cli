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
 * - 冲突行 — 禁勾禁操作,引导到幕布终端解决;
 * - 批量:邮件式拖选扩散勾选(工作区会话列表管理模式同款),勾选集 = 批量条
 *   动作面(暂存/放弃/删除);未跟踪行另有 (删除) hover 动作(git clean)。
 */

import { t } from "@kernel/i18n";
import { useMemo, useRef, useState } from "react";
import type { GitFileStatus, GitTotals } from "@kernel/ipc";
import { FRow } from "./DiffFlatRow";
import { DiffBatchBar } from "./DiffBatchBar";
import { sweepKeys } from "./diffSweep";

interface Props {
  files: GitFileStatus[];
  cwd: string;
  checked: ReadonlySet<string>;
  totals: GitTotals | null;
  onToggleCheck: (path: string) => void;
  /** 拖选扩散:整批设/清勾选(勾选集同时是批量条动作面) */
  onSetChecks: (paths: string[], val: boolean) => void;
  onOpen: (file: GitFileStatus) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  /** 删除未跟踪文件(git clean) */
  onClean: (paths: string[]) => void;
}

interface Section {
  key: "un" | "ut" | "st";
  title: string;
  rows: GitFileStatus[];
}

/** 命中测试:坐标 → 拖选行下标(查不到回 -1)。同 SessionManage 的 data-mrow 契约。 */
function idxFromPoint(x: number, y: number): number {
  const row = document.elementFromPoint(x, y)?.closest("[data-mrow]");
  const idx = row ? Number(row.getAttribute("data-mrow")) : Number.NaN;
  return Number.isInteger(idx) ? idx : -1;
}

export function DiffFlatList({
  files,
  cwd,
  checked,
  totals,
  onToggleCheck,
  onSetChecks,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
  onClean,
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
        title: t("未暂存变更"),
        rows: files.filter((f) => f.wt && f.status !== "?"),
      },
      {
        key: "ut",
        title: t("未跟踪文件"),
        rows: files.filter((f) => f.status === "?"),
      },
      {
        key: "st",
        title: t("待提交变更"),
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

  /* 拖选序:未暂存(非冲突)→ 未跟踪,与渲染顺序一致;键 = 路径。
   * 待提交段已必进提交,不参选;冲突行禁操作,不参选。 */
  const { sweepOrder, mrowByKey } = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, number>();
    for (const f of [...sections[0].rows, ...sections[1].rows]) {
      if (f.status === "C") continue;
      byKey.set(f.path, order.length);
      order.push(f.path);
    }
    return { sweepOrder: order, mrowByKey: byKey };
  }, [sections]);

  /* 邮件式拖选(会话列表管理模式同款):按下锚定但不改动,滑过行才按锚点值
   * 整段扩散 —— 纯点击保持「开 diff」语义,不吃掉勾选。 */
  const dragRef = useRef<{ anchorKey: string; val: boolean } | null>(null);
  const lastIdxRef = useRef(-1);
  const dragMovedRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    dragMovedRef.current = false;
    if (idx < 0) return;
    const anchorKey = sweepOrder[idx];
    if (anchorKey === undefined) return;
    dragRef.current = { anchorKey, val: !checked.has(anchorKey) };
    lastIdxRef.current = idx;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx < 0 || idx === lastIdxRef.current) return;
    lastIdxRef.current = idx;
    dragMovedRef.current = true;
    const anchor = sweepOrder.indexOf(dragRef.current.anchorKey);
    if (anchor < 0) {
      dragRef.current = null;
      return;
    }
    onSetChecks(sweepKeys(sweepOrder, anchor, idx), dragRef.current.val);
  };
  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: () => (dragRef.current = null),
    onPointerCancel: () => (dragRef.current = null),
    onPointerLeave: () => (dragRef.current = null),
  };

  /* 批量条动作面:勾选集 ∩ 当前未暂存/未跟踪行,按能力分流(放弃限 M/T) */
  const checkedRows = useMemo(
    () =>
      [...sections[0].rows, ...sections[1].rows].filter(
        (f) => checked.has(f.path) && f.status !== "C",
      ),
    [sections, checked],
  );
  const stagePaths = checkedRows.map((f) => f.path);
  const discardPaths = checkedRows
    .filter((f) => f.status === "M" || f.status === "T")
    .map((f) => f.path);
  const deletePaths = checkedRows.filter((f) => f.status === "?").map((f) => f.path);

  return (
    <div className="font-mono text-xs" {...dragHandlers}>
      {sections.map((sec) => {
        const isCollapsed = collapsed[sec.key];
        return (
          <div key={sec.key}>
            {/* 头行:左段折叠开关(原生 button,键盘天然可达),
                右段批量动作按钮与之平级 —— 不再嵌进可点容器(嵌套交互违规) */}
            <div className="flex items-baseline gap-2 px-3 pb-0.5 pt-1.5 text-(--tmd-fg-muted)">
              <button
                type="button"
                onClick={() => toggle(sec.key)}
                className="flex min-w-0 flex-1 cursor-pointer select-none items-baseline gap-2 text-left [font:inherit] text-(--tmd-fg-muted)"
              >
                <span
                  className={`text-[0.5625rem] text-(--tmd-fg-faint) ${isCollapsed ? "-rotate-90" : ""}`}
                >
                  ▾
                </span>
                <span className="whitespace-nowrap">{sec.title}</span>
                {sec.rows.length > 0 && (
                  <span className="text-(--tmd-fg-faint)">({sec.rows.length})</span>
                )}
              </button>
              {!isCollapsed && sec.key === "un" && utPaths.length + unPaths.length > 0 && (
                <button
                  type="button"
                  title={t("git add 全部未暂存与未跟踪文件")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage([...unPaths, ...utPaths]);
                  }}
                  className="text-[0.6875rem] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
                >
                  {t("(全部暂存)")}
                </button>
              )}
              {!isCollapsed && sec.key === "st" && stPaths.length > 0 && (
                <button
                  type="button"
                  title={t("git reset 全部已暂存文件")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage(stPaths);
                  }}
                  className="text-[0.6875rem] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
                >
                  {t("(全部取消)")}
                </button>
              )}
            </div>
            {!isCollapsed &&
              (sec.rows.length === 0 ? (
                <div className="py-0.5 pl-3 text-[0.6875rem] text-(--tmd-fg-faint)">(nothing)</div>
              ) : (
                sec.rows.map((f) => (
                  <FRow
                    cwd={cwd}
                    key={`${sec.key}:${f.path}`}
                    file={f}
                    side={sec.key}
                    checked={checked.has(f.path)}
                    mrow={sec.key === "st" ? undefined : mrowByKey.get(f.path)}
                    nums={numsByKey.get(`${sec.key === "st" ? "s" : "w"}:${f.path}`)}
                    onToggleCheck={() => onToggleCheck(f.path)}
                    onOpen={() => {
                      /* 拖选结束的那次 click 不当点击:只选不开 diff */
                      if (!dragMovedRef.current) onOpen(f);
                    }}
                    onStage={() => onStage([f.path])}
                    onUnstage={() => onUnstage([f.path])}
                    onDiscard={() => onDiscard([f.path])}
                    onDelete={() => onClean([f.path])}
                  />
                ))
              ))}
          </div>
        );
      })}
      {/* 批量条:勾选集非空即现,动作按区能力分流;破坏性动作确认在 DiffView */}
      <DiffBatchBar
        count={checkedRows.length}
        stagePaths={stagePaths}
        discardPaths={discardPaths}
        deletePaths={deletePaths}
        onStage={onStage}
        onDiscard={onDiscard}
        onDelete={onClean}
      />
    </div>
  );
}
