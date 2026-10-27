/**
 * 体检面板状态钩子(自 LintView 拆出守复杂度与 300 行铁则)。
 * useLintRun:六步管线运行态;useLintResultWrite:结果回写;useLintApply:
 * 建议动作/确认弹层(带 diff 与 hook 块预览)/busy 旗标。确认弹层的内容在
 * 动作触发时现算(重读现文 → 纯变换 → diffUtil),确认后才真落盘。
 */

import { useCallback, useState, type ReactNode } from "react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { runLint, type LintProgress, type LintRunResult } from "./lintModel";
import { addHandled, removeHandled } from "./lintStore";
import {
  applyFindingFixpath, applyFindingStub, applyFindingWrite,
  applyRestore, applyRuleAdvice, applyRuleHook,
} from "./lintActions";
import {
  appendRuleLine, buildHookBlock, CLAUDE_STUB, fixPathInFile, removeRuleFromFile,
} from "./applyLint";
import { diffLines } from "./diffUtil";
import { DiffPreview } from "./LintRows";
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
          timeoutSeconds: 240,
          onProgress: (p) => setProgress(p),
        });
        setResult(r);
        if (r.engineError) onError(r.engineError);
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

/** 结果写回:行落定(记录已拍板指纹)/行重开(删指纹)/发现移除。 */
export function useLintResultWrite(
  result: LintRunResult | null,
  applyResult: (r: LintRunResult) => void,
): {
  markRowSettled: (row: LintRow) => void;
  reopenRow: (row: LintRow) => void;
  removeFinding: (finding: StaticFinding) => void;
} {
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
  const reopenRow = useCallback(
    (row: LintRow) => {
      if (!result || !row.judgment) return;
      const kind = row.judgment.verdict === "dormant" ? "dormant" : "violated";
      void removeHandled(settledSig(kind, row.rule));
      applyResult({
        ...result,
        rows: result.rows.map((r) => (r.rule === row.rule ? { ...r, settled: false } : r)),
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
  return { markRowSettled, reopenRow, removeFinding };
}

export interface LintApplyState {
  busy: boolean;
  confirm: { title: string; message: ReactNode; run: () => void } | null;
  closeConfirm: () => void;
  onApply: (row: LintRow, advice: LintAdvice) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onStub: (finding: StaticFinding) => void;
  onWrite: (finding: StaticFinding) => void;
  onFixpath: (finding: StaticFinding) => void;
  onRestore: (paths: string[]) => void;
}

/** 动作态:按建议写回(删除/归档/收口/修路径/写入/hook 过确认弹层)、保持拍板、
 *  重开拍板、备份恢复。markRowSettled/removeFinding 由视图注入。 */
export function useLintApply(
  cwd: string | null,
  onError: (msg: string) => void,
  markRowSettled: (row: LintRow) => void,
  removeFinding: (finding: StaticFinding) => void,
  afterWrite: () => void,
): LintApplyState {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<LintApplyState["confirm"]>(null);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const exec = useCallback(
    (task: () => Promise<{ ok: boolean; note: string }>, onOk: () => void) => {
      setBusy(true);
      void (async () => {
        try {
          const r = await task();
          if (r.ok) onOk();
          else if (r.note) onError(r.note);
        } finally {
          setBusy(false);
        }
      })();
    },
    [onError],
  );
  const doApply = useCallback(
    (row: LintRow, advice: LintAdvice) => {
      if (!cwd) return;
      exec(() => applyRuleAdvice(cwd, row, advice), () => {
        markRowSettled(row);
        afterWrite();
      });
    },
    [cwd, exec, markRowSettled, afterWrite],
  );
  const onApply = useCallback(
    (row: LintRow, advice: LintAdvice) => {
      if (advice !== "remove" && advice !== "archive") {
        doApply(row, advice);
        return;
      }
      void ipc.fsReadFile(row.rule.file).then(
        (text) => {
          const next = removeRuleFromFile(text, row.rule, advice === "archive");
          if (next === null) {
            onError("文件已变化,行号对不上;请重新体检");
            return;
          }
          setConfirm({
            title: advice === "remove" ? t("删除该规则?") : t("归档该规则?"),
            message: (
              <>
                <div>{row.rule.file}</div>
                <DiffPreview lines={diffLines(text, next)} />
              </>
            ),
            run: () => doApply(row, advice),
          });
        },
        () => onError("规则文件读不到,请重新体检"),
      );
    },
    [doApply, onError],
  );
  const onKeep = useCallback((row: LintRow) => markRowSettled(row), [markRowSettled]);
  const onHook = useCallback(
    (row: LintRow) => {
      if (!cwd) return;
      setConfirm({
        title: t("生成 pre-commit 钩子?"),
        message: (
          <>
            <div>{cwd}/.git/hooks/pre-commit</div>
            <DiffPreview lines={buildHookBlock(row.rule).split("\n").filter(Boolean).map((text) => ({ kind: "add" as const, text }))} />
          </>
        ),
        run: () => exec(() => applyRuleHook(cwd, row), afterWrite),
      });
    },
    [cwd, exec, afterWrite],
  );
  const onStub = useCallback(
    (finding: StaticFinding) => {
      void ipc.fsReadFile(finding.file).then(
        (text) => {
          setConfirm({
            title: t("收口为 stub?"),
            message: (
              <>
                <div>{finding.file}</div>
                <DiffPreview lines={diffLines(text, CLAUDE_STUB)} />
              </>
            ),
            run: () => exec(() => applyFindingStub(finding), () => { removeFinding(finding); afterWrite(); }),
          });
        },
        () => onError("规则文件读不到,请重新体检"),
      );
    },
    [exec, afterWrite, onError, removeFinding],
  );
  const onWrite = useCallback(
    (finding: StaticFinding) => {
      void ipc.fsReadFile(finding.file).then(
        (text) => {
          const next = appendRuleLine(text, finding.text);
          setConfirm({
            title: t("写进 AGENTS.md?"),
            message: (
              <>
                <div>{finding.file}</div>
                <DiffPreview lines={diffLines(text, next)} />
              </>
            ),
            run: () => exec(() => applyFindingWrite(finding), () => { removeFinding(finding); afterWrite(); }),
          });
        },
        () => onError("规则文件读不到,请重新体检"),
      );
    },
    [exec, afterWrite, onError, removeFinding],
  );
  const onFixpath = useCallback(
    (finding: StaticFinding) => {
      const [oldP, newP] = (finding.extra ?? "").split("=>");
      if (!oldP || !newP) {
        onError("修复建议缺少路径对,请重新体检");
        return;
      }
      void ipc.fsReadFile(finding.file).then(
        (text) => {
          const lineNo = Number.parseInt(finding.id.split("|")[2] ?? "", 10);
          const next = fixPathInFile(text, lineNo, oldP, newP);
          if (next === null) {
            onError("文件已变化,行号对不上;请重新体检");
            return;
          }
          setConfirm({
            title: t("修正引用路径?"),
            message: (
              <>
                <div>{finding.file}</div>
                <DiffPreview lines={diffLines(text, next)} />
              </>
            ),
            run: () => exec(() => applyFindingFixpath(finding), () => { removeFinding(finding); afterWrite(); }),
          });
        },
        () => onError("规则文件读不到,请重新体检"),
      );
    },
    [exec, afterWrite, onError, removeFinding],
  );
  const onRestore = useCallback(
    (paths: string[]) => {
      setConfirm({
        title: t("恢复备份?"),
        message: (
          <>
            <div>{t("把这些文件的 .bak-tmdlint 备份写回原文件(备份保留)")}</div>
            <div className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-(--tmd-fg-muted)">{paths.join("\n")}</div>
          </>
        ),
        run: () => exec(() => applyRestore(paths), afterWrite),
      });
    },
    [exec, afterWrite],
  );
  return { busy, confirm, closeConfirm, onApply, onKeep, onHook, onStub, onWrite, onFixpath, onRestore };
}
