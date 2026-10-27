/**
 * 体检面板状态钩子(自 LintPanel 拆出守复杂度与 300 行铁则)。
 * useLintRun:六步管线运行态;useLintApply:建议动作/确认弹层/busy 旗标。
 * 行级落定与发现移除的状态回写由调用方注入(钩子只管动作编排)。
 */

import { useCallback, useState } from "react";
import { t } from "@kernel/i18n";
import { runLint, type LintProgress, type LintRunResult } from "./lintModel";
import { addHandled } from "./lintStore";
import { applyFindingStub, applyRuleAdvice } from "./lintActions";
import { settledSig, type LintAdvice, type LintRow, type StaticFinding } from "./lintTypes";

export interface LintRunState {
  running: boolean;
  progress: LintProgress | null;
  result: LintRunResult | null;
  start: () => void;
  applyResult: (r: LintRunResult) => void;
}

/** 运行态:体检一次全流程;取消(新体检令牌顶掉旧跑)静默不报错。 */
export function useLintRun(
  cwd: string | null,
  workspaceId: string | null,
  engineId: string,
  model: string,
  onError: (msg: string) => void,
): LintRunState {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LintProgress | null>(null);
  const [result, setResult] = useState<LintRunResult | null>(null);
  const start = useCallback(() => {
    if (!cwd || running) return;
    setRunning(true);
    onError("");
    setProgress({ step: "targets", detail: "" });
    void (async () => {
      try {
        const r = await runLint({
          cwd, workspaceId, engineId, model: model.trim() || null,
          timeoutSeconds: 120,
          onProgress: (p) => setProgress(p),
        });
        setResult(r);
      } catch (e) {
        if (!String(e).includes("lint-cancelled")) onError(String(e).slice(0, 160));
      } finally {
        setRunning(false);
        setProgress(null);
      }
    })();
  }, [cwd, running, engineId, model, workspaceId, onError]);
  return { running, progress, result, start, applyResult: setResult };
}

export interface LintApplyState {
  busy: boolean;
  confirm: { title: string; message: string; run: () => void } | null;
  closeConfirm: () => void;
  onApply: (row: LintRow, advice: LintAdvice) => void;
  onKeep: (row: LintRow) => void;
  onStub: (finding: StaticFinding) => void;
}

/** 结果写回:行落定(记录已拍板指纹)与发现移除的结果态回写。 */
export function useLintResultWrite(
  result: LintRunResult | null,
  applyResult: (r: LintRunResult) => void,
): { markRowSettled: (row: LintRow) => void; removeFinding: (finding: StaticFinding) => void } {
  const markRowSettled = useCallback(
    (row: LintRow) => {
      if (!result) return;
      if (row.judgment) {
        const kind = row.judgment.verdict === "dormant" ? "dormant" : "violated";
        void addHandled([settledSig(kind, row.rule)]);
      }
      applyResult({
        ...result,
        rows: result.rows.map((r) => (r.rule === row.rule ? { ...r, settled: true } : r)),
      });
    },
    [result, applyResult],
  );
  const removeFinding = useCallback(
    (finding: StaticFinding) => {
      if (!result) return;
      applyResult({ ...result, findings: result.findings.filter((f) => f !== finding) });
    },
    [result, applyResult],
  );
  return { markRowSettled, removeFinding };
}

/** 动作态:按建议写回(删除过确认弹层)、保持拍板、drift 收口。
 *  markRowSettled/removeFinding 由面板注入(同时落已拍板指纹与列表回写)。 */
export function useLintApply(
  cwd: string | null,
  onError: (msg: string) => void,
  markRowSettled: (row: LintRow) => void,
  removeFinding: (finding: StaticFinding) => void,
): LintApplyState {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<LintApplyState["confirm"]>(null);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const doApply = useCallback(
    (row: LintRow, advice: LintAdvice) => {
      if (!cwd) return;
      setBusy(true);
      void (async () => {
        try {
          const r = await applyRuleAdvice(cwd, row, advice);
          if (r.ok) markRowSettled(row);
          else if (r.note) onError(r.note);
        } finally {
          setBusy(false);
        }
      })();
    },
    [cwd, markRowSettled, onError],
  );
  const onApply = useCallback(
    (row: LintRow, advice: LintAdvice) => {
      if (advice !== "remove") {
        doApply(row, advice);
        return;
      }
      setConfirm({
        title: t("删除该规则?"),
        message: `${t("将从规则文件删除该行(先备份 .bak-tmdlint)")}:\n${row.rule.text.split("\n")[0] ?? ""}`,
        run: () => doApply(row, advice),
      });
    },
    [doApply],
  );
  const onKeep = useCallback(
    (row: LintRow) => markRowSettled(row),
    [markRowSettled],
  );
  const onStub = useCallback(
    (finding: StaticFinding) => {
      setConfirm({
        title: t("收口为 stub?"),
        message: `${t("整文件替换为一行声明(先备份 .bak-tmdlint)")}:${finding.file}`,
        run: () => {
          setBusy(true);
          void (async () => {
            try {
              const r = await applyFindingStub(finding);
              if (r.ok) removeFinding(finding);
              else if (r.note) onError(r.note);
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    },
    [onError, removeFinding],
  );
  return { busy, confirm, closeConfirm, onApply, onKeep, onStub };
}
