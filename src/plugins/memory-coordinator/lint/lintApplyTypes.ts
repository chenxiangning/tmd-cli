/**
 * 应用动作类型(useLintApply 的返回契约,拆出以满足 300 行铁则)。
 */

import type { ReactNode } from "react";
import type { LintAdvice, LintRow, StaticFinding } from "./lintTypes";

/** 单条应用动作面(useLintApply 返回;确认弹层与回调在此声明)。 */
export interface LintApplyState {
  busy: boolean;
  confirm: { title: string; message: ReactNode; run: () => void } | null;
  closeConfirm: () => void;
  onApply: (row: LintRow, advice: LintAdvice) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onRewrite: (row: LintRow) => void;
  onApplyAllAi: (rows: LintRow[], onApplied: (applied: number, skipped: number) => void) => void;
  onStub: (finding: StaticFinding) => void;
  onWrite: (finding: StaticFinding) => void;
  onFixpath: (finding: StaticFinding) => void;
  onRestore: (paths: string[]) => void;
}
