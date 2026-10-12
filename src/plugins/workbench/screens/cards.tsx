/**
 * 工作台 · 视图屏幕共享契约与项目卡(模块看板/状态看板/列表共用)。
 */

import { t } from "@kernel/i18n";
import { projectRisk } from "../analysis";
import { RISK_LABELS, remainingText, taskDigest } from "../insights";
import type { Project } from "../types";
import { WbBadge, WbProgress } from "../ui";

/** 各视图屏幕的统一 props:projects = 已筛选+风险排序;allProjects = 全量。 */
export interface WbScreenProps {
  projects: readonly Project[];
  allProjects: readonly Project[];
  today: string;
  onOpen: (id: string) => void;
  onNewProject: () => void;
  onLinkWorkspaces: () => void;
  onToast: (message: string) => void;
  /** 文档中心深链过滤(项目详情「本项目生成记录」);其余视图忽略。 */
  docsFilter?: string | null;
  /** 空态「生成文档」主按钮(带 projectId 时弹窗预锁该项目);仅文档中心消费。 */
  onDocGen?: (projectId?: string) => void;
}

/** 看板段头(标题 + 计数);任务看板与模块看板的项目状态段共用。 */
export function BoardHead({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="wb-board-head">
      <b>{label}</b>
      <span>{count}</span>
    </h3>
  );
}

export function RiskPill({ project, today }: { project: Project; today: string }) {
  const risk = projectRisk(project, today);
  return <WbBadge tone={risk.tone}>{t(RISK_LABELS[risk.level])}</WbBadge>;
}

/** 项目卡(模块看板/状态看板):名称 + 风险徽标 + 进度条 + 到期/任务微摘要。 */
export function ProjectCard({ project, today, onOpen, compact }: {
  project: Project;
  today: string;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  const digest = taskDigest(project, today);
  return (
    <button type="button" className={`wb-card${compact ? " is-compact" : ""}`} onClick={() => onOpen(project.id)}>
      <span className="wb-card-head">
        <b className="wb-card-name">{project.name}</b>
        <RiskPill project={project} today={today} />
      </span>
      <span className="wb-card-meta">
        <span>{project.owner || t("未指定")}</span>
        <span>{remainingText(project.dueDate, today)}</span>
      </span>
      <WbProgress value={project.progress} />
      <span className="wb-card-foot">
        <span>{project.progress}%</span>
        {digest.open > 0 ? <span className="wb-card-tasks">{t("{count} 项任务", { count: digest.open })}</span> : null}
      </span>
    </button>
  );
}
