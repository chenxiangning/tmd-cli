/**
 * 体检视图状态钩子(自 LintView 拆出守复杂度与 300 行铁则)。
 * useLintController:订阅控制器单例(右栏/中央报告共享同一份运行态);
 * useLintResultWrite:结果回写(拍板/重开/发现移除);useLintApply:建议动作/
 * 确认弹层(带 diff 与 hook 块预览)/AI 改写(单条+一键)/busy 旗标。弹层内容
 * 在动作触发时现算(重读现文 → 纯变换 → diffUtil),确认后才真落盘。
 */

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { LintApplyState } from "./lintApplyTypes";
import { getLintState, mutateLintResult, subscribeLint, type LintControllerState } from "./lintController";
import { addHandled, removeHandled } from "./lintStore";
import {
  applyAllAiRewrites, applyFindingFixpath, applyFindingStub, applyFindingWrite,
  applyRestore, applyRuleAdvice, applyRuleHook, applyRuleRewrite,
} from "./lintActions";
import { appendRuleLine, buildHookBlock, CLAUDE_STUB, fixPathInFile, removeRuleFromFile, replaceRuleFromFile } from "./applyLint";
import { diffLines } from "./diffUtil";
import { DiffPreview } from "./LintRows";
import { settledSig, type LintAdvice, type LintRow, type StaticFinding } from "./lintTypes";

/** 订阅控制器单例(运行进度/增量结果/错误,右栏与中央报告同源)。 */
export function useLintController(): LintControllerState {
  return useSyncExternalStore(subscribeLint, getLintState);
}

/** 结果回写:行落定(记录已拍板指纹)/行重开(删指纹)/发现移除。 */
export function useLintResultWrite(): {
  markRowSettled: (row: LintRow) => void;
  reopenRow: (row: LintRow) => void;
  removeFinding: (finding: StaticFinding) => void;
} {
  const markRowSettled = useCallback((row: LintRow) => {
    if (row.judgment) {
      const kind = row.judgment.verdict === "dormant" ? "dormant" : "violated";
      void addHandled([settledSig(kind, row.rule)]);
    }
    mutateLintResult((r) => ({ ...r, rows: r.rows.map((x) => (x.rule === row.rule ? { ...x, settled: true } : x)) }));
  }, []);
  const reopenRow = useCallback((row: LintRow) => {
    if (!row.judgment) return;
    const kind = row.judgment.verdict === "dormant" ? "dormant" : "violated";
    void removeHandled(settledSig(kind, row.rule));
    mutateLintResult((r) => ({ ...r, rows: r.rows.map((x) => (x.rule === row.rule ? { ...x, settled: false } : x)) }));
  }, []);
  const removeFinding = useCallback((finding: StaticFinding) => {
    mutateLintResult((r) => ({ ...r, findings: r.findings.filter((f) => f !== finding) }));
  }, []);
  return { markRowSettled, reopenRow, removeFinding };
}

/** 行号重排:该文件中被改行之后的规则行随 delta 平移(应用改写/删除后行号失配的根治)。 */
function shiftRowsAfter(file: string, afterLine: number, delta: number): void {
  if (delta === 0) return;
  mutateLintResult((r) => ({
    ...r,
    rows: r.rows.map((x) =>
      x.rule.file === file && x.rule.line > afterLine
        ? { ...x, rule: { ...x.rule, line: x.rule.line + delta, lineEnd: Math.max(x.rule.lineEnd + delta, x.rule.line + delta) } }
        : x,
    ),
  }));
}

export function useLintApply(
  cwd: string | null,
  onError: (msg: string) => void,
  removeFinding: (finding: StaticFinding) => void,
): LintApplyState {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<LintApplyState["confirm"]>(null);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const exec = useCallback(
    (task: () => Promise<{ ok: boolean; note: string }>, onOk: () => void = () => {}) => {
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
  /** 重读现文 → 纯变换构建弹层(标题/预览/新文本)→ 确认后执行真动作。 */
  const readAndConfirm = useCallback(
    (
      path: string,
      failNote: string,
      build: (text: string) => { title: string; message: ReactNode; next: string | null; run: () => void },
    ) => {
      void ipc.fsReadFile(path).then(
        (text) => {
          const built = build(text);
          if (built.next === null) {
            onError("文件已变化,行号对不上;请重新体检");
            return;
          }
          setConfirm({ title: built.title, message: built.message, run: built.run });
        },
        () => onError(failNote),
      );
    },
    [onError],
  );

  const onApply = useCallback(
    (row: LintRow, advice: LintAdvice) => {
      if (advice !== "remove" && advice !== "archive") {
        exec(() => applyRuleAdvice(cwd ?? "", row, advice));
        return;
      }
      readAndConfirm(row.rule.file, t("规则文件读不到,请重新体检"), (text) => {
        const next = removeRuleFromFile(text, row.rule, advice === "archive");
        const delta = next === null ? 0 : next.split("\n").length - text.split("\n").length;
        return {
          title: advice === "remove" ? t("删除该规则?") : t("归档该规则?"),
          message: (
            <>
              <div>{row.rule.file}</div>
              <DiffPreview lines={diffLines(text, next ?? text)} />
            </>
          ),
          next,
          run: () => exec(() => applyRuleAdvice(cwd ?? "", row, advice), () => shiftRowsAfter(row.rule.file, row.rule.lineEnd, delta)),
        };
      });
    },
    [cwd, exec, readAndConfirm],
  );
  const onKeep = useCallback((row: LintRow) => {
    if (row.judgment) {
      const kind = row.judgment.verdict === "dormant" ? "dormant" : "violated";
      void addHandled([settledSig(kind, row.rule)]);
    }
    mutateLintResult((r) => ({ ...r, rows: r.rows.map((x) => (x.rule === row.rule ? { ...x, settled: true } : x)) }));
  }, []);
  const onHook = useCallback(
    (row: LintRow) => {
      setConfirm({
        title: t("生成 pre-commit 钩子?"),
        message: (
          <>
            <div>.git/hooks/pre-commit</div>
            <DiffPreview lines={buildHookBlock(row.rule).split("\n").filter(Boolean).map((text) => ({ kind: "add" as const, text }))} />
          </>
        ),
        run: () => exec(() => applyRuleHook(cwd ?? "", row)),
      });
    },
    [cwd, exec],
  );
  const onRewrite = useCallback(
    (row: LintRow) => {
      const rewrite = row.aiMark?.rewrite ?? row.judgment?.fix ?? "";
      if (!rewrite.trim()) {
        onError(t("该规则没有 AI 改写建议"));
        return;
      }
      readAndConfirm(row.rule.file, t("规则文件读不到,请重新体检"), (text) => {
        const next = replaceRuleFromFile(text, row.rule, rewrite);
        const delta = next === null ? 0 : next.split("\n").length - text.split("\n").length;
        return {
          title: t("应用 AI 改写?"),
          message: (
            <>
              <div>{row.rule.file}</div>
              <DiffPreview lines={diffLines(text, next ?? text)} />
            </>
          ),
          next,
          run: () => exec(() => applyRuleRewrite(row), () => shiftRowsAfter(row.rule.file, row.rule.line, delta)),
        };
      });
    },
    [readAndConfirm, exec, onError],
  );
  const onApplyAllAi = useCallback(
    (rows: LintRow[], onApplied: (applied: number, skipped: number) => void) => {
      const pending = rows.filter((r) => !r.settled && (r.aiMark?.rewrite || r.judgment?.fix));
      if (pending.length === 0) {
        onError(t("没有待应用的 AI 改写建议"));
        return;
      }
      setConfirm({
        title: t("一键应用 AI 改写?"),
        message: (
          <>
            <div>{t("将替换 {n} 条带 AI 建议的规则行(逐行守卫,先备份,记应用日志)", { n: String(pending.length) })}</div>
            <div className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-(--tmd-fg-muted)">
              {[...new Set(pending.map((r) => r.rule.file))].join("\n")}
            </div>
          </>
        ),
        run: () =>
          exec(async () => {
            const r = await applyAllAiRewrites(rows);
            onApplied(r.applied, r.skipped);
            return r;
          }),
      });
    },
    [exec, onError],
  );
  const onStub = useCallback(
    (finding: StaticFinding) => {
      readAndConfirm(finding.file, t("规则文件读不到,请重新体检"), (text) => ({
        title: t("收口为 stub?"),
        message: (
          <>
            <div>{finding.file}</div>
            <DiffPreview lines={diffLines(text, CLAUDE_STUB)} />
          </>
        ),
        next: CLAUDE_STUB,
        run: () => exec(() => applyFindingStub(finding), () => removeFinding(finding)),
      }));
    },
    [readAndConfirm, removeFinding, exec],
  );
  const onWrite = useCallback(
    (finding: StaticFinding) => {
      readAndConfirm(finding.file, t("规则文件读不到,请重新体检"), (text) => {
        const next = appendRuleLine(text, finding.text);
        return {
          title: t("写进 AGENTS.md?"),
          message: (
            <>
              <div>{finding.file}</div>
              <DiffPreview lines={diffLines(text, next)} />
            </>
          ),
          next,
          run: () => exec(() => applyFindingWrite(finding), () => removeFinding(finding)),
        };
      });
    },
    [readAndConfirm, removeFinding, exec],
  );
  const onFixpath = useCallback(
    (finding: StaticFinding) => {
      const [oldP, newP] = (finding.extra ?? "").split("=>");
      if (!oldP || !newP) {
        onError(t("修复建议缺少路径对,请重新体检"));
        return;
      }
      readAndConfirm(finding.file, t("规则文件读不到,请重新体检"), (text) => {
        const lineNo = Number.parseInt(finding.id.split("|")[2] ?? "", 10);
        const next = fixPathInFile(text, lineNo, oldP, newP);
        return {
          title: t("修正引用路径?"),
          message: (
            <>
              <div>{finding.file}</div>
              <DiffPreview lines={diffLines(text, next ?? text)} />
            </>
          ),
          next,
          run: () => exec(() => applyFindingFixpath(finding), () => removeFinding(finding)),
        };
      });
    },
    [readAndConfirm, onError, removeFinding, exec],
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
        run: () => exec(() => applyRestore(paths)),
      });
    },
    [exec],
  );
  return { busy, confirm, closeConfirm, onApply, onKeep, onHook, onRewrite, onApplyAllAi, onStub, onWrite, onFixpath, onRestore };
}
