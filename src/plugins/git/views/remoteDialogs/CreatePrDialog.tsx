/**
 * CreatePrDialog —— 创建 Pull Request 对话框(mossx 同构复刻,spec 2026-09-15):
 * 四下拉(base/head 仓与分支)+ 提交预览行 + 标题/描述 + 自动评论开关 + 评论内容。
 * 「创建 PR」走四步工作流(git_pr_run),阶段经 git://pr-stage 事件实时点亮 PrStages;
 * 范围闸门要求确认时出横幅,确认后带 fingerprint 重试。数据来源:defaults =
 * git_pr_defaults(upstream/origin 解析);分支候选 = git_branches(远端去前缀)。
 * 与 push/pull/fetch 对话框不同:执行期对话框保持打开(进度卡就地呈现)。
 * 表单分件见 createPrDialogParts,状态机见 prDialogModel。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { GitPullRequest } from "@phosphor-icons/react";
import {
  ipc,
  onGitPrStage,
  type GitBranchList,
  type GitPrDefaults,
  type GitPrStage,
  type GitPrWorkflowResult,
} from "@kernel/ipc";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import {
  buildRequest,
  canSubmit,
  formFromDefaults,
  initialStages,
  mergeStages,
  remoteBranchShort,
  type PrForm,
} from "./prDialogModel";
import { GateBanner, PrCommentSection, PrPickers, PrPreview, PrTextFields } from "./createPrDialogParts";
import { PrStages } from "./PrStages";

export function CreatePrDialog({
  cwd,
  repoName,
  onClose,
}: {
  cwd: string;
  /** 当前仓目录名(多仓语境显示于标题行右缘);单仓 undefined 不显示 */
  repoName?: string;
  onClose: () => void;
}) {
  const [defaults, setDefaults] = useState<GitPrDefaults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<PrForm | null>(null);
  const [branches, setBranches] = useState<GitBranchList | null>(null);
  const [stages, setStages] = useState<GitPrStage[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GitPrWorkflowResult | null>(null);
  const [gate, setGate] = useState<GitPrWorkflowResult["confirmation"]>(null);
  const [copied, setCopied] = useState(false);

  /* 打开即拉 defaults 与分支候选;canCreate=false 时横幅给原因并禁提交。 */
  useEffect(() => {
    let alive = true;
    ipc.gitPrDefaults(cwd).then(
      (d) => {
        if (!alive) return;
        setDefaults(d);
        setForm(formFromDefaults(d));
      },
      (e: unknown) => {
        if (alive) setLoadError(String(e));
      },
    );
    ipc.gitBranches(cwd).then((b) => {
      if (alive) setBranches(b);
    }, () => {});
    return () => {
      alive = false;
    };
  }, [cwd]);

  /* 执行期订阅阶段事件;结束后退订(result/stages 已带终态)。 */
  useEffect(() => {
    if (!running) return;
    const sub = onGitPrStage((next) => setStages((prev) => mergeStages(prev, next)));
    return () => {
      void sub.then((off) => off());
    };
  }, [running]);

  const run = useCallback(
    (allowLargeRange: boolean, fingerprint: string | null) => {
      if (!form) return;
      setGate(null);
      setResult(null);
      setStages(initialStages());
      setRunning(true);
      ipc.gitPrRun(cwd, buildRequest(form, allowLargeRange, fingerprint)).then(
        (res) => {
          setResult(res);
          setStages(res.stages);
          setGate(res.confirmation);
          setRunning(false);
        },
        (e: unknown) => {
          setResult({
            ok: false,
            message: String(e),
            prUrl: null,
            prNumber: null,
            stages: [],
            confirmation: null,
          });
          setRunning(false);
        },
      );
    },
    [cwd, form],
  );

  const patch = useCallback((p: Partial<PrForm>) => setForm((f) => (f ? { ...f, ...p } : f)), []);
  const onPatch = useCallback(
    (p: Partial<PrForm>) => patch(p),
    [patch],
  );
  const onSet = useCallback(
    <K extends keyof PrForm>(k: K) =>
      (v: PrForm[K]) =>
        patch({ [k]: v } as Partial<PrForm>),
    [patch],
  );
  const headRepo = form ? `${form.headOwner}/${form.upstreamRepo.split("/")[1] ?? ""}` : "";
  const baseOptions = (branches?.remote ?? []).map((b) => remoteBranchShort(b.name));
  const headOptions = (branches?.local ?? []).map((b) => b.name);

  return (
    <DialogShell
      title={t("创建 Pull Request")}
      icon={<GitPullRequest className="h-[1.125rem] w-[1.125rem]" aria-hidden />}
      repoName={repoName}
      width={640}
      locked={running}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("创建 PR")}
          confirmDisabled={running || !canSubmit(form)}
          submitting={running}
          onCancel={onClose}
          onConfirm={() => run(false, null)}
        />
      }
    >
      {(loadError || (defaults && !defaults.canCreate && defaults.disabledReason)) && (
        <div className="mt-3 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-2.5 text-xs text-(--tmd-diff-removed)">
          {loadError ?? defaults?.disabledReason}
        </div>
      )}
      {form && (
        <>
          <PrPickers
            form={form}
            defaults={defaults}
            baseOptions={baseOptions}
            headOptions={headOptions}
            headRepo={headRepo}
            onSet={onSet}
          />
          <PrPreview form={form} />
          <PrTextFields form={form} running={running} onPatch={onPatch} />
          <PrCommentSection form={form} running={running} onSet={onSet} />
          {gate && <GateBanner gate={gate} running={running} onConfirm={() => run(true, gate.fingerprint)} />}
          <PrStages
            stages={stages}
            result={result}
            onCopy={(url) => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          />
          {copied && (
            <div className="mt-1 text-[0.6875rem] text-(--tmd-fg-muted)">{t("已复制链接")}</div>
          )}
        </>
      )}
    </DialogShell>
  );
}
