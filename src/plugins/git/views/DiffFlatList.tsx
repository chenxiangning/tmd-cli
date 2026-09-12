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

import { t } from "@kernel/i18n";
import { useMemo, useState } from "react";
import type { GitFileStatus, GitTotals } from "@kernel/ipc";
import { FRow } from "./DiffFlatRow";

interface Props {
  files: GitFileStatus[];
  cwd: string;
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
  cwd,
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

  return (
    <div className="font-mono text-xs">
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

