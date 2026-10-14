/**
 * 工作台 · 项目详情内容体(中央 tab 渲染,ProjectTab 承载):页签
 * 概要/文档/任务/进展/会话。概要页 = 信息栅格 + 资料摘要(文档/任务/
 * 进展计数,点击跳页签)+ 主动作(编辑/建任务/开会话)+ 生成文档(预览
 * 弹层,类型即内容差异)。文档/任务页签在 drawerTabs.tsx;会话页签 =
 * 项目任务关联会话汇总(collectLinkedSessions),未关联会话一律不显示。
 */

import { useMemo, useState, type ReactNode } from "react";
import { t } from "@kernel/i18n";
import { ChatCircle, FileText, ListChecks, Notebook, PencilSimple, Plus, Sparkle } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { clampProgress, projectRisk, slippage, todayISO, type RiskInfo } from "./analysis";
import { useProjectSessions } from "./useProjectSessions";
import { collectLinkedSessions, resolveWorkspaceId } from "./views";
import { RISK_LABELS, remainingText } from "./insights";
import { WbBadge, WbProgress, WbSessionActs } from "./ui";
import { DrawerTasksTab, DrawerUpdatesTab } from "./drawerTabs";
import { InfoDashboard } from "./InfoDashboard";
import { DrawerDocsTab } from "./DrawerDocsTab";
import { updateProject } from "./store";
import { updateTab } from "@kernel/tabs";
import { ProjectFormModal } from "./ProjectFormModal";
import { createSessionHere, openLink } from "./sessionOpen";
import { DocGenDialog } from "./docgen/DocGenDialog";
import { openWorkbenchDocsTab } from "./wbTabs";
import { isTaskOpen, type Project, type ProjectTask } from "./types";

export type DrawerTab = "info" | "docs" | "tasks" | "updates" | "sessions";

/** risk.detail 渲染层 i18n:analysis 的 detail 是内容层中文(含插值),这里按
 *  level 重建 —— remainingDays 随行携带,slipping 的百分比经 slippage 现算。 */
function riskDetailText(risk: RiskInfo, project: Project, today: string): string {
  const days = risk.remainingDays;
  switch (risk.level) {
    case "done": return t("已交付");
    case "blocked": return t("处于阻塞状态,需要推动");
    case "unscheduled": return t("未设置截止日期");
    case "overdue": return t("已超过截止日期 {days} 天", { days: Math.abs(days ?? 0) });
    case "urgent": return days === 0 ? t("今天到期") : t("只剩 {days} 天", { days: days ?? 0 });
    case "soon": return t("还剩 {days} 天", { days: days ?? 0 });
    case "normal": return t("还剩 {days} 天,节奏正常", { days: days ?? 0 });
    case "slipping": {
      const slip = slippage(project, today);
      if (slip === null) return t("未设置截止日期");
      return t("时间已过 {percent}% 但进度只有 {progress}%", { percent: Math.round(slip * 100), progress: clampProgress(project) });
    }
  }
}

const TABS: readonly { key: DrawerTab; label: string }[] = [
  { key: "info", label: "概要" },
  { key: "docs", label: "文档" },
  { key: "tasks", label: "任务" },
  { key: "updates", label: "进展" },
  { key: "sessions", label: "会话" },
];

export function ProjectDetail({
  project, onToast, initialTab,
}: {
  project: Project;
  onToast: (message: string) => void;
  /** 深链聚焦页签(溯源「进展 →」跳转);缺省概要。 */
  initialTab?: DrawerTab;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab ?? "info");
  const [docGenOpen, setDocGenOpen] = useState(false);
  /* 任务表单状态上提:概要页「建任务」跳任务页签内嵌开单(不再是弹窗)。 */
  const [taskForm, setTaskForm] = useState<{ open: boolean; task: ProjectTask | null }>({ open: false, task: null });
  const [editOpen, setEditOpen] = useState(false);
  /* 概要 dashboard 文档行深开:记录目标文档 id,切到文档页签即直开编辑器。 */
  const [docJumpId, setDocJumpId] = useState<string | null>(null);
  const today = todayISO();
  const risk = projectRisk(project, today);
  const openTasks = project.tasks.filter(isTaskOpen).length;

  return (
    <div className="wb-drawer">
      <div className="wb-drawer-head">
        <WbBadge tone={risk.tone}>{t(RISK_LABELS[risk.level])}</WbBadge>
        <div className="wb-progress-wrap">
          <WbProgress value={project.progress} tone={risk.tone} />
          <b className="wb-progress-pct">{project.progress}%</b>
        </div>
        {/* 天数表述只留一处:urgent/soon/normal/overdue 的 riskDetail 已含天数;
         *  blocked/slipping 再补剩余天数,done/unscheduled 补天数只是噪声。 */}
        <span className="wb-drawer-head-meta">
          {riskDetailText(risk, project, today)}
          {risk.level === "blocked" || risk.level === "slipping" ? ` · ${remainingText(project.dueDate, today)}` : null}
        </span>
      </div>
      <nav className="wb-drawer-tabs" role="tablist" aria-label={t("项目页签")}>
        {TABS.map((item) => (
          <button
            key={item.key} type="button" role="tab"
            aria-selected={tab === item.key}
            className={`wb-drawer-tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {t(item.label)}
            {item.key === "docs" && project.docs.length > 0 ? <span className="wb-tab-n">{project.docs.length}</span> : null}
            {item.key === "tasks" && openTasks > 0 ? <span className="wb-tab-n">{openTasks}</span> : null}
          </button>
        ))}
      </nav>
      <div className={`wb-drawer-body${tab === "info" ? " is-flow" : ""}`}>
        {tab === "info" ? (
          <InfoTab
            project={project}
            today={today}
            onEdit={() => setEditOpen(true)}
            onNewTask={() => { setTab("tasks"); setTaskForm({ open: true, task: null }); }}
            onDocGen={() => setDocGenOpen(true)}
            onJump={setTab}
            onOpenDoc={setDocJumpId}
            onToast={onToast}
          />
        ) : null}
        {tab === "docs" ? <DrawerDocsTab project={project} initialOpenDocId={docJumpId} onToast={onToast} /> : null}
        {tab === "tasks" ? <DrawerTasksTab project={project} form={taskForm} onFormChange={setTaskForm} onToast={onToast} /> : null}
        {tab === "updates" ? <DrawerUpdatesTab project={project} onToast={onToast} /> : null}
        {tab === "sessions" ? <SessionsTab project={project} onToast={onToast} /> : null}
      </div>
      {docGenOpen ? (
        <DocGenDialog
          lockedProject={project}
          projects={[project]}
          today={todayISO()}
          onClose={() => setDocGenOpen(false)}
          onToast={onToast}
        />
      ) : null}
      {editOpen ? (
        <ProjectFormModal
          key={project.id}
          project={project}
          onClose={() => setEditOpen(false)}
          onSubmit={async (values) => {
            await updateProject(project.id, values);
            if (values.name !== project.name) updateTab(`wb-project:${project.id}`, { title: values.name });
            setEditOpen(false);
            onToast(t("已保存"));
          }}
        />
      ) : null}
    </div>
  );
}

function InfoTab({ project, today, onEdit, onNewTask, onDocGen, onJump, onOpenDoc, onToast }: {
  project: Project;
  today: string;
  onEdit: (project: Project) => void;
  onNewTask: () => void;
  onDocGen: () => void;
  onJump: (tab: DrawerTab) => void;
  /** 概要 dashboard 文档行深开:回写目标文档 id,ProjectDetail 切文档页签直开编辑器。 */
  onOpenDoc: (docId: string) => void;
  onToast: (message: string) => void;
}) {
  const rows: Array<[string, string]> = [
    [t("模块"), project.module || t("其他项目")],
    [t("状态"), t(project.status)],
    [t("负责人"), project.owner || t("未指定")],
    [t("起止"), `${project.startedOn ?? t("未填")} → ${project.dueDate ?? t("未排期")}`],
    [t("标签"), project.tags.length > 0 ? project.tags.join("、") : "—"],
    [t("绑定目录"), project.cwd ?? t("未绑定")],
    [t("链接"), project.link ?? "—"],
  ];
  const stats: Array<{ key: DrawerTab; label: string; count: number; icon: ReactNode }> = [
    { key: "docs", label: t("资料文档"), count: project.docs.length, icon: <FileText size={15} /> },
    { key: "tasks", label: t("任务"), count: project.tasks.length, icon: <ListChecks size={15} /> },
    { key: "updates", label: t("进展记录"), count: project.updates.length, icon: <Notebook size={15} /> },
    { key: "sessions", label: t("会话"), count: collectLinkedSessions(project.tasks).length, icon: <ChatCircle size={15} /> },
  ];
  return (
    <div className="wb-info">
      <div className="wb-info-stats">
        {stats.map((item) => (
          <button key={item.key} type="button" className="wb-stat" onClick={() => onJump(item.key)}>
            <span className="wb-stat-ico">{item.icon}</span>
            <span className="wb-stat-body">
              <b>{item.count}</b>
              <span>{item.label}</span>
            </span>
          </button>
        ))}
      </div>
      <InfoDashboard
        project={project}
        today={today}
        onJump={(tab, docId) => { onJump(tab); if (docId) onOpenDoc(docId); }}
        onToast={onToast}
      />
      <section className="wb-info-card">
        <h4>{t("项目信息")}</h4>
        <div className="wb-info-grid">
          {rows.map(([label, value]) => (
            <div key={label} className="wb-info-row">
              <span className="wb-info-label">{label}</span>
              <span className="wb-info-value" title={value}>{value}</span>
            </div>
          ))}
        </div>
        {project.summary ? <p className="wb-info-summary">{project.summary}</p> : null}
      </section>
      <div className="wb-info-actions">
        <button type="button" className="wb-btn" onClick={() => onEdit(project)}>
          <PencilSimple size={12} />{t("编辑")}
        </button>
        <button type="button" className="wb-btn" onClick={onNewTask}>
          <Plus size={12} />{t("建任务")}
        </button>
        <span className="dg-sp" />
        <button type="button" className="wb-info-link" onClick={() => openWorkbenchDocsTab(project.id)}>
          {t("本项目生成记录 →")}
        </button>
        <button type="button" className="wb-btn wb-btn-primary" onClick={onDocGen}>
          <Sparkle size={12} />{t("生成文档…")}
        </button>
      </div>
    </div>
  );
}

function SessionsTab({ project, onToast }: {
  project: Project;
  onToast: (message: string) => void;
}) {
  useHost(); /* 活会话表变化即重渲(行名/运行徽实时)。 */
  const hostSessions = host.getSessions();
  /* cwd → 工作区 id:会话挂树必带,孤儿会话侧栏不收(精确命中,子目录取最深前缀)。 */
  const workspaceId = resolveWorkspaceId(useWorkspaces().list, project.cwd);
  /* 仅作「在此目录开新会话」的引擎档位(取该目录最近会话的 profile),与任务详情同口径。 */
  const recent = useProjectSessions(project.cwd);
  /* 开新会话在途禁用:连点会重复建会话。 */
  const [creating, setCreating] = useState(false);
  const links = useMemo(() => collectLinkedSessions(project.tasks), [project.tasks]);
  const newHere = () => {
    if (!project.cwd || creating) return;
    setCreating(true);
    createSessionHere(project, workspaceId, recent, onToast, () => setCreating(false));
  };
  if (!project.cwd) return <p className="wb-muted">{t("未绑定工作区目录;绑定后可在任务里开会话并关联。")}</p>;
  return (
    <div className="wb-sessions">
      <div className="wb-list-head">
        <h3>{t("会话")}<span className="wb-count">{links.length}</span></h3>
        <button type="button" className="wb-btn wb-btn-primary" onClick={newHere} disabled={creating}>
          <Plus size={12} />{t("在此目录开新会话")}
        </button>
      </div>
      {links.length === 0 ? (
        <p className="wb-muted">{t("还没有任务关联的会话;在任务详情里「开新会话并关联」。")}</p>
      ) : (
        <ul className="wb-session-list">
          {links.map((link) => {
            /* 实时名/状态口径与任务详情一致:活会话命中行名跟随,终结回落快照。 */
            const live = hostSessions.find((s) => s.id === link.ref || s.cliSessionId === link.ref);
            const profileName = host.getCliProfile(link.profileId)?.name ?? link.profileId;
            return (
              <li key={link.ref} className="wb-session-li">
                <button type="button" className="wb-session-row" onClick={() => openLink(link, project, workspaceId, onToast, recent)}>
                  <span className="wb-attach-ico"><ChatCircle size={14} /></span>
                  <span className="wb-session-body">
                    <span className="wb-session-title">{live?.title || link.title || link.ref}</span>
                    <span className={`wb-session-meta${live ? " wb-session-live" : ""}`}>
                      {live ? t("运行中") : t("已完成")} · {profileName} · {link.createdAt.slice(0, 10)}
                    </span>
                  </span>
                </button>
                <WbSessionActs link={link} project={project} workspaceId={workspaceId} recent={recent} live={live} onToast={onToast} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
