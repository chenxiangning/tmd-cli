/**
 * 工作台 · 项目详情内容体(中央 tab 渲染,ProjectTab 承载):页签
 * 概要/文档/任务/进展/会话。概要页 = 信息栅格 + 资料摘要(文档/任务/
 * 进展计数,点击跳页签)+ 主动作(编辑/建任务/开会话)+ 生成文档(预览
 * 弹层,类型即内容差异)。文档/任务页签在 drawerTabs.tsx;会话页签 =
 * 项目任务关联会话汇总(collectLinkedSessions),未关联会话一律不显示。
 */

import { useMemo, useState, type ReactNode } from "react";
import { t } from "@kernel/i18n";
import { ChatCircle, FileText, ListChecks, Notebook, PencilSimple, Plus } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { useWorkspaces } from "@kernel/workspace";
import { formatRemaining, projectRisk, todayISO } from "./analysis";
import { useProjectSessions } from "./useProjectSessions";
import { collectLinkedSessions, resolveWorkspaceId } from "./views";
import { WbBadge, WbProgress } from "./ui";
import { DrawerTasksTab, DrawerUpdatesTab } from "./drawerTabs";
import { DrawerDocsTab } from "./DrawerDocsTab";
import { updateProject } from "./store";
import { updateTab } from "@kernel/tabs";
import { ProjectFormModal } from "./ProjectFormModal";
import { TaskFormModal } from "./TaskFormModal";
import { openLink } from "./sessionOpen";
import { DocPreviewDialog, type DocRequest } from "./DocPreviewDialog";
import { docRequests } from "./wbTabs";
import type { Project } from "./types";

type DrawerTab = "info" | "docs" | "tasks" | "updates" | "sessions";

const TABS: readonly { key: DrawerTab; label: string }[] = [
  { key: "info", label: "概要" },
  { key: "docs", label: "文档" },
  { key: "tasks", label: "任务" },
  { key: "updates", label: "进展" },
  { key: "sessions", label: "会话" },
];

export function ProjectDetail({
  project, onToast,
}: {
  project: Project;
  onToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("info");
  const [docRequest, setDocRequest] = useState<DocRequest | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const risk = projectRisk(project);
  const openTasks = project.tasks.filter((task) => task.status !== "done").length;

  return (
    <div className="wb-drawer">
      <div className="wb-drawer-head">
        <WbBadge tone={risk.tone}>{risk.label}</WbBadge>
        <div className="wb-progress-wrap">
          <WbProgress value={project.progress} tone={risk.tone} />
          <b className="wb-progress-pct">{project.progress}%</b>
        </div>
        <span className="wb-drawer-head-meta">{risk.detail} · {formatRemaining(project.dueDate)}</span>
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
      <div className="wb-drawer-body">
        {tab === "info" ? (
          <InfoTab
            project={project}
            onEdit={() => setEditOpen(true)}
            onNewTask={() => setTaskFormOpen(true)}
            onDoc={setDocRequest}
            onJump={setTab}
          />
        ) : null}
        {tab === "docs" ? <DrawerDocsTab project={project} onToast={onToast} /> : null}
        {tab === "tasks" ? <DrawerTasksTab project={project} onToast={onToast} /> : null}
        {tab === "updates" ? <DrawerUpdatesTab project={project} onToast={onToast} /> : null}
        {tab === "sessions" ? <SessionsTab project={project} onToast={onToast} /> : null}
      </div>
      {docRequest ? (
        <DocPreviewDialog
          request={docRequest}
          projects={[project]}
          project={project}
          today={todayISO()}
          onClose={() => setDocRequest(null)}
          onToast={onToast}
        />
      ) : null}
      {taskFormOpen ? (
        <TaskFormModal
          project={project}
          task={null}
          onClose={() => setTaskFormOpen(false)}
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

function InfoTab({ project, onEdit, onNewTask, onDoc, onJump }: {
  project: Project;
  onEdit: (project: Project) => void;
  onNewTask: () => void;
  onDoc: (request: DocRequest) => void;
  onJump: (tab: DrawerTab) => void;
}) {
  const docs = useMemo(() => docRequests(), []);
  const rows: Array<[string, string]> = [
    [t("模块"), project.module || "其他项目"],
    [t("状态"), project.status],
    [t("负责人"), project.owner || "未指定"],
    [t("起止"), `${project.startedOn ?? t("未填")} → ${project.dueDate ?? t("未排期")}`],
    [t("标签"), project.tags.length > 0 ? project.tags.join("、") : "—"],
    [t("绑定目录"), project.cwd ?? t("未绑定")],
    [t("链接"), project.link ?? "—"],
  ];
  const stats: Array<{ key: DrawerTab; label: string; count: number; icon: ReactNode }> = [
    { key: "docs", label: t("资料文档"), count: project.docs.length, icon: <FileText size={15} /> },
    { key: "tasks", label: t("任务"), count: project.tasks.length, icon: <ListChecks size={15} /> },
    { key: "updates", label: t("进展记录"), count: project.updates.length, icon: <Notebook size={15} /> },
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
        <span className="wb-info-actions-label">{t("生成文档")}</span>
        {docs.map((doc) => (
          <button key={doc.kind} type="button" className="wb-btn wb-btn-xs" onClick={() => onDoc(doc)}>{doc.label}</button>
        ))}
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
  const links = useMemo(() => collectLinkedSessions(project.tasks), [project.tasks]);
  const newHere = () => {
    if (!project.cwd) return;
    const profileId = recent?.[0]?.profileId;
    if (!profileId) {
      onToast(t("该目录暂无可用引擎会话,请先在侧栏开过一次"));
      return;
    }
    void host.createSession(profileId, project.cwd, workspaceId).then(
      (meta) => {
        host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
        host.setActiveSession(meta.id);
      },
      () => onToast(t("创建会话失败")),
    );
  };
  if (!project.cwd) return <p className="wb-muted">{t("未绑定工作区目录;绑定后可在任务里开会话并关联。")}</p>;
  return (
    <div className="wb-sessions">
      <div className="wb-list-head">
        <h3>{t("会话")}<span className="wb-count">{links.length}</span></h3>
        <button type="button" className="wb-btn wb-btn-primary" onClick={newHere}>
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
              <li key={link.ref}>
                <button type="button" className="wb-session-row" onClick={() => openLink(link, project, workspaceId, onToast, recent)}>
                  <span className="wb-attach-ico"><ChatCircle size={14} /></span>
                  <span className="wb-session-body">
                    <span className="wb-session-title">{live?.title || link.title || link.ref}</span>
                    <span className={`wb-session-meta${live ? " wb-session-live" : ""}`}>
                      {live ? t("运行中") : t("已完成")} · {profileName} · {link.createdAt.slice(0, 10)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
