/**
 * 双栏 diff 折叠焦点(N4)交互件 —— 全文态连续 context 段压缩成的就地展开胶囊。
 * 展开态按 run 键(双侧起号)存,段集换代(切文件/重拉)渲染期派生整组复位;
 * 胶囊 = 真按钮(aria-expanded),wrap 态通栏一条,nowrap 态左右内容栈各一条、
 * 双号槽放同高空带(行高四面同源机制见 SplitDiffView 的 pin)。
 */
import { useState, type CSSProperties } from "react";
import { t } from "@kernel/i18n";
import type { FoldRun } from "./patchModel";

/** 折叠段就地展开态:段集换代即整组复位(渲染期派生重置,无 effect)。 */
export function useFoldRuns(runs: Map<number, FoldRun> | null): [Set<string>, (key: string) => void] {
  const sig = runs ? [...runs.values()].map((r) => r.key).join(",") : "";
  const [state, setState] = useState({ sig, open: new Set<string>() });
  if (state.sig !== sig) setState({ sig, open: new Set() });
  const toggle = (key: string) =>
    setState((s) => {
      const open = new Set(s.open);
      if (open.has(key)) open.delete(key);
      else open.add(key);
      return { sig: s.sig, open };
    });
  return [state.open, toggle];
}

/** 胶囊条:··· N 行未改动 + 双侧行号区间 + 展开/收起(原型 ctxbar 形态)。 */
export function FoldBar({
  run,
  open,
  onToggle,
  style,
  /** 读屏去重:halves 态右栈的视觉冗余实例——aria-hidden 出读屏 + tabIndex 出 tab 序。 */
  ghost,
}: {
  run: FoldRun;
  open: boolean;
  onToggle: (key: string) => void;
  style?: CSSProperties;
  ghost?: boolean;
}) {
  return (
    <button
      type="button"
      style={style}
      className="git-split-fold"
      aria-expanded={open}
      aria-hidden={ghost || undefined}
      tabIndex={ghost ? -1 : undefined}
      onClick={() => onToggle(run.key)}
    >
      <span className="git-split-fold-dots" aria-hidden>
        ···
      </span>
      <span>
        {run.count} {t("行未改动")}
      </span>
      <span className="git-split-fold-rng">
        {run.oldFrom}–{run.oldTo} / {run.newFrom}–{run.newTo}
      </span>
      <span className="git-split-fold-ct">{open ? t("收起") : t("展开")}</span>
    </button>
  );
}
