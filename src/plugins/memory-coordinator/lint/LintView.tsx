/**
 * 记忆文件面板 · 规则体检视图(tmd-lint 收编,内嵌于本面板,自带返回)。
 *
 * 交互闭环(用户定版 2026-10-28):运行与结束后右栏一律保留 PTY 幕布全程;
 * 审核与应用操作只在中央报告 tab,本视图不做第二份结果面。
 */

import { useCallback, useEffect, useState } from "react";
import { LintHeaderBar } from "./LintHeaderBar";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { PtyCurtain } from "./LintCurtain";
import type { LintRunResult } from "./lintModel";
import { loadStore, setLastUsed } from "./lintStore";
import { seedLintResult, startLint, openLintReport } from "./lintController";
import { useLintApply, useLintController, useLintResultWrite } from "./lintPanelState";

/* 头部条在 LintHeaderBar(模型下拉与工作台引擎选择同口径)。 */

export function LintView({ cwd, workspaceId, onBack }: { cwd: string | null; workspaceId: string | null; onBack: () => void }) {
  const ctl = useLintController();
  const { removeFinding } = useLintResultWrite();
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const onError = useCallback((msg: string) => setActionError(msg), []);
  const apply = useLintApply(cwd, onError, removeFinding);
  const [engineId, setEngineId] = useState("omp");
  const [model, setModel] = useState("");

  /* 挂载:回填上次引擎选择;同 cwd 的上次结果播种进控制器(重开不丢) */
  useEffect(() => {
    void loadStore().then((d) => {
      if (d.lastUsed) {
        setEngineId(d.lastUsed.engineId);
        setModel(d.lastUsed.model);
      }
      if (d.lastResult && d.lastResult.cwd === cwd) {
        /* 旧存储形态缺新字段,播种前补齐 */
        seedLintResult({
          ...d.lastResult,
          corpus: (d.lastResult as LintRunResult).corpus ?? { sessionCount: 0, readFiles: 0, msgs: d.lastResult.rows.length, calls: 0 },
          failedBatches: (d.lastResult as LintRunResult).failedBatches ?? 0,
          engineError: (d.lastResult as LintRunResult).engineError ?? "",
          backups: (d.lastResult as LintRunResult).backups ?? [],
        });
      }
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时回放 */
  }, [cwd]);

  const showError = ctl.error || actionError;
  const start = useCallback(() => {
    if (!cwd) return;
    void setLastUsed(engineId, model).then(() => {
      setActionError("");
      setNotice("");
      startLint({ cwd, workspaceId, engineId, model: model.trim() || null, scopes: ["project", "global"], onError: setActionError });
      openLintReport();
    });
  }, [cwd, engineId, model, workspaceId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LintHeaderBar
        engineId={engineId} model={model} running={ctl.running} cwd={cwd}
        setEngineId={setEngineId} setModel={setModel} onStart={start} onBack={onBack}
      />
      {!cwd && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-fg-muted)">{t("打开一个工作区后可体检其规则文件")}</div>}
      {(ctl.running || ctl.progress) && (
        <div className="flex min-h-0 flex-1 flex-col">
          <PtyCurtain progress={ctl.progress!} title={`${engineId}${model ? ` · ${model}` : ""}`} log={ctl.log} running={ctl.running} />
          {!ctl.running && (
            <button type="button" onClick={start} className="mx-1.5 mb-1.5 flex-none rounded-md border border-(--tmd-border) px-2 py-1 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent)">
              {t("重新体检")}
            </button>
          )}
        </div>
      )}
      {showError && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-error)">{showError}</div>}
      {notice && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-ok)">{notice}</div>}

      {!ctl.progress && !ctl.running && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-meta leading-relaxed text-(--tmd-fg-muted)">
          {t(
            "体检两步走:先脚本扫描(读各家 CLI 近 30 天对话日志,规则逐条上屏),再把配置完整发给 AI 逐条识别——能执行的打标记给说明,不能执行的给修改建议,可单条改也可一键应用。",
          )}
        </div>
      )}
      <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
        {t("每次应用记前后内容(报告页可回看/恢复);写回前自动备份 .bak-tmdlint;判定随引擎与模型而异")}
      </div>
      {apply.confirm && (
        <ConfirmDialog
          title={apply.confirm.title}
          message={apply.confirm.message}
          danger
          confirmLabel={t("确认")}
          onConfirm={() => {
            apply.confirm!.run();
            apply.closeConfirm();
          }}
          onClose={apply.closeConfirm}
        />
      )}
    </div>
  );
}
