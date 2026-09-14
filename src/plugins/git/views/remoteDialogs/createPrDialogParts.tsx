/**
 * CreatePrDialog 表单分件(降组件复杂度 + 文件规模铁则,pushDialogParts 同款拆法):
 * 四下拉 / 提交预览行 / 标题描述 / 自动评论段。状态全部由
 * CreatePrDialog 下发,本文件零 useState(范围闸门横幅已随闸门移除,2026-09-15)。
 */

import { t } from "@kernel/i18n";
import { ArrowsLeftRight, ChatCircleDots } from "@phosphor-icons/react";
import type { GitPrDefaults } from "@kernel/ipc";
import { OpToggle } from "@kernel/DialogShell";
import { StyledSelect } from "@kernel/StyledSelect";
import type { PrForm } from "./prDialogModel";

export const inputCls =
  "w-full rounded border border-(--tmd-border) bg-transparent px-2 py-1 font-mono text-xs text-(--tmd-fg) focus:border-(--tmd-accent) focus:outline-none disabled:opacity-50";

/** 标签 + 控件竖排单元(四下拉/标题/描述共用)。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-(--tmd-fg-muted)">{label}</span>
      {children}
    </label>
  );
}

const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x.trim()))];

/** 四下拉:base 仓/分支 + head 仓/分支(mossx 布局:双列两组)。 */
export function PrPickers({
  form,
  defaults,
  baseOptions,
  headOptions,
  headRepo,
  onSet,
}: {
  form: PrForm;
  defaults: GitPrDefaults | null;
  baseOptions: string[];
  headOptions: string[];
  headRepo: string;
  onSet: <K extends keyof PrForm>(k: K) => (v: PrForm[K]) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Field label={t("base repository")}>
        <StyledSelect
          value={form.upstreamRepo}
          options={uniq([form.upstreamRepo, defaults?.upstreamRepo ?? ""]).map((v) => ({ value: v }))}
          onChange={onSet("upstreamRepo")}
          ariaLabel={t("base repository")}
        />
      </Field>
      <Field label={t("base")}>
        <StyledSelect
          value={form.baseBranch}
          options={uniq([form.baseBranch, ...baseOptions]).map((v) => ({ value: v }))}
          onChange={onSet("baseBranch")}
          ariaLabel={t("base")}
        />
      </Field>
      <Field label={t("head repository")}>
        <StyledSelect
          value={headRepo}
          options={uniq([headRepo]).map((v) => ({ value: v }))}
          onChange={() => {}}
          ariaLabel={t("head repository")}
        />
      </Field>
      <Field label={t("compare")}>
        <StyledSelect
          value={form.headBranch}
          options={uniq([form.headBranch, ...headOptions]).map((v) => ({ value: v }))}
          onChange={onSet("headBranch")}
          ariaLabel={t("compare")}
        />
      </Field>
    </div>
  );
}

/** 提交预览行:upstream/base ← owner/branch。 */
export function PrPreview({ form }: { form: PrForm }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2.5 font-mono text-xs text-(--tmd-fg-muted)">
      <ArrowsLeftRight className="h-[0.875rem] w-[0.875rem] shrink-0" aria-hidden />
      <span className="truncate">
        {form.upstreamRepo}/{form.baseBranch} ← {form.headOwner}/{form.headBranch}
      </span>
    </div>
  );
}

/** 标题 + 描述输入。 */
export function PrTextFields({
  form,
  running,
  onPatch,
}: {
  form: PrForm;
  running: boolean;
  onPatch: (p: Partial<PrForm>) => void;
}) {
  return (
    <>
      <div className="mt-3">
        <Field label={t("PR 标题")}>
          <input
            value={form.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            disabled={running}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="mt-2.5">
        <Field label={t("PR 描述")}>
          <textarea
            value={form.body}
            onChange={(e) => onPatch({ body: e.target.value })}
            disabled={running}
            rows={4}
            aria-label={t("PR 描述")}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </div>
    </>
  );
}

/** 自动评论开关 + 评论内容(mossx「创建后自动评论 @审批」)。 */
export function PrCommentSection({
  form,
  running,
  onSet,
}: {
  form: PrForm;
  running: boolean;
  onSet: <K extends keyof PrForm>(k: K) => (v: PrForm[K]) => void;
}) {
  return (
    <div className="mt-2.5">
      <OpToggle
        active={form.commentAfterCreate}
        icon={<ChatCircleDots className="h-[0.875rem] w-[0.875rem]" aria-hidden />}
        label={t("创建后自动评论 @审批")}
        disabled={running}
        onToggle={() => onSet("commentAfterCreate")(!form.commentAfterCreate)}
      />
      {form.commentAfterCreate && (
        <textarea
          value={form.commentBody}
          onChange={(e) => onSet("commentBody")(e.target.value)}
          disabled={running}
          rows={2}
          aria-label={t("评论内容")}
          className={`${inputCls} mt-1.5 resize-y`}
        />
      )}
    </div>
  );
}
