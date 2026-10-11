/**
 * 工作台 · 生成文档预览弹层:四种文档类型(周报/状态汇报/风险清单/会议纪要)
 * 与进展分析提示词共用 —— 点类型先看全文预览,再决定复制;解决「点了都一样」
 * 的感知问题(内容即差异)。
 */

import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { buildAnalysisPrompt, buildDocDraft } from "./prompt";
import type { Project } from "./types";

export type DocRequest =
  | { kind: "analysis"; label: string }
  | { kind: string; label: string };

export function DocPreviewDialog({
  request, projects, project, today, onClose, onToast,
}: {
  request: DocRequest;
  projects: readonly Project[];
  /** 单项目语境(项目详情内);文档只按该项目生成。 */
  project?: Project | null;
  today: string;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const scope = project ? { projects: [project], project } : { projects, project: null };
  const content = request.kind === "analysis"
    ? buildAnalysisPrompt({ ...scope, today })
    : buildDocDraft(request.kind, { ...scope, today });
  const copy = () => {
    navigator.clipboard?.writeText(content).then(
      () => onToast(t("已复制:{label}", { label: request.label })),
      () => onToast(t("复制失败")),
    );
  };
  return (
    <DialogShell
      title={request.label}
      icon={null}
      width={860}
      onClose={onClose}
      footer={<DialogActions confirmLabel={t("复制全文")} onConfirm={copy} onCancel={onClose} cancelLabel={t("关闭")} />}
    >
      <pre className="wb-docpreview">{content}</pre>
    </DialogShell>
  );
}
