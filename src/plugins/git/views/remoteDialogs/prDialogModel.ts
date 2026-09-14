/**
 * 创建 PR 对话框纯逻辑 —— 表单构造/请求装配/阶段合并(mossx 同口径,spec 2026-09-15)。
 * 组件交互见 CreatePrDialog;四步进度卡渲染见 PrStages。
 */

import type { GitPrDefaults, GitPrRequest, GitPrStage } from "@kernel/ipc";

/** 表单态:defaults 填充后可编辑的全部字段。 */
export interface PrForm {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body: string;
  commentAfterCreate: boolean;
  commentBody: string;
}

/** defaults → 表单初值;自动评论默认开(mossx 口径)。 */
export function formFromDefaults(d: GitPrDefaults): PrForm {
  return {
    upstreamRepo: d.upstreamRepo,
    baseBranch: d.baseBranch,
    headOwner: d.headOwner,
    headBranch: d.headBranch,
    title: d.title,
    body: d.body,
    commentAfterCreate: true,
    commentBody: d.commentBody,
  };
}

/** 阶段四卡初始态(全 pending,等 git://pr-stage 事件逐卡点亮)。 */
export function initialStages(): GitPrStage[] {
  return (["precheck", "push", "createPr", "comment"] as const).map((key) => ({
    key,
    status: "pending",
    detail: "",
  }));
}

/** 事件权威合并:后端 stages 全量覆盖;本地多出的 key 保留在尾(防异常缺卡)。 */
export function mergeStages(prev: GitPrStage[], next: GitPrStage[]): GitPrStage[] {
  const keys = new Set(next.map((s) => s.key));
  return [...next, ...prev.filter((s) => !keys.has(s.key))];
}

/** 装配工作流请求。范围闸门已移除(2026-09-15),无授权重试字段。 */
export function buildRequest(form: PrForm): GitPrRequest {
  return {
    upstreamRepo: form.upstreamRepo.trim(),
    baseBranch: form.baseBranch.trim(),
    headOwner: form.headOwner.trim(),
    headBranch: form.headBranch.trim(),
    title: form.title.trim(),
    body: form.body.trim() ? form.body : null,
    commentAfterCreate: form.commentAfterCreate,
    commentBody: form.commentAfterCreate && form.commentBody.trim() ? form.commentBody : null,
  };
}

/** 提交就绪:五必填(upstream/base/owner/branch/标题)非空。 */
export function canSubmit(form: PrForm | null): boolean {
  return (
    !!form &&
    [form.upstreamRepo, form.baseBranch, form.headOwner, form.headBranch, form.title].every(
      (v) => v.trim().length > 0,
    )
  );
}

/** 远端分支名 → 短名("origin/main" → "main";无前缀原样)。 */
export function remoteBranchShort(name: string): string {
  const i = name.indexOf("/");
  return i > 0 ? name.slice(i + 1) : name;
}
