/**
 * 工作台 · 项目概要 dashboard(概要页签第二排):文档/任务/进展/会话四
 * 区块的简略全局展示,替代「只有计数卡」的空概要。数据切片来自
 * summaryData.ts(纯函数);区块头「全部 →」跳对应页签;会话行实时状态
 * 口径与会话页签一致(host 快照命中 = 运行中)。
 */

import { t } from "@kernel/i18n";
import { ChatCircle } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { openFileInTab } from "@kernel/fileTabs";
import { useState } from "react";
import { daysLeft } from "./analysis";
import { remainingText } from "./insights";
import { bytes, DOC_KIND_LABELS, TASK_STATUS_LABELS, UPDATE_KIND_LABELS } from "./kindLabels";
import { taskStatusTone } from "./taskPrompt";
import { collectLinkedSessions, resolveWorkspaceId } from "./views";
import { useProjectSessions } from "./useProjectSessions";
import { openLink } from "./sessionOpen";
import { WbImgView, WbSessionActs } from "./ui";
import { docAttachmentPath, readDocDataUrl } from "./workbenchFiles";
import { BOARD_STATUSES, type Project, type ProjectDoc } from "./types";
import { dueTasks, taskStatusCounts } from "./summaryData";

/** 概要页可跳转的目标页签(不含概要自身);docId = 文档行深开编辑器。 */
type JumpTab = "docs" | "tasks" | "updates" | "sessions";

function DashHead({ label, count, onJump }: { label: string; count: number; onJump: () => void }) {
  return (
    <div className="wb-dash-head">
      <h4>{label}<span className="wb-dash-n">{count}</span></h4>
      <button type="button" className="wb-info-more" onClick={onJump}>{t("全部 →")}</button>
    </div>
  );
}

function TaskDash({ project, today, onJump }: { project: Project; today: string; onJump: () => void }) {
  const { counts, total } = taskStatusCounts(project.tasks);
  const due = dueTasks(project, 3);
  return (
    <section className="wb-info-card wb-dash">
      <DashHead label={t("任务")} count={project.tasks.length} onJump={onJump} />
      {total > 0 ? (
        <>
          <div className="wb-dash-bar" role="img" aria-label={t("任务状态分布")}>
            {BOARD_STATUSES.map((status) => counts[status] > 0 ? (
              <i key={status} style={{ width: `${(counts[status] / total) * 100}%`, background: taskStatusTone(status) }} />
            ) : null)}
          </div>
          <div className="wb-dash-legend">
            {BOARD_STATUSES.map((status) => (
              <span key={status}>
                <i style={{ background: taskStatusTone(status) }} />
                {t(TASK_STATUS_LABELS[status])} {counts[status]}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="wb-muted">{t("还没有任务。")}</p>
      )}
      {due.length > 0 ? (
        <ul className="wb-dash-rows">
          {due.map((task) => {
            const left = daysLeft(task.dueDate, today) ?? 0;
            return (
              <li key={task.id}>
                <span className="wb-dash-row-title" title={task.title}>{task.title}</span>
                <span className={`wb-dash-due${left < 0 ? " is-over" : left <= 3 ? " is-near" : ""}`}>
                  {remainingText(task.dueDate, today)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : total > 0 ? <p className="wb-muted wb-dash-hint">{t("暂无到期任务")}</p> : null}
    </section>
  );
}

function DocDash({ project, onJump, onToast }: { project: Project; onJump: (tab: JumpTab, docId?: string) => void; onToast: (message: string) => void }) {
  const rows = [...project.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  /* 行点按 = 直开:markdown 深开文档页签编辑器;图片就地预览;其余文件 tab。 */
  const open = (doc: ProjectDoc) => {
    if (doc.kind === "markdown") { onJump("docs", doc.id); return; }
    if (doc.kind === "image") {
      void readDocDataUrl(project.id, doc.fileName).then(
        (url) => { if (url) setPreview({ name: doc.title, url }); else onToast(t("附件读取失败")); },
        () => onToast(t("附件读取失败")),
      );
      return;
    }
    void docAttachmentPath(project.id, doc.fileName)
      .then((p) => openFileInTab(p, doc.title))
      .catch(() => onToast(t("附件打开失败")));
  };
  return (
    <section className="wb-info-card wb-dash">
      <DashHead label={t("文档")} count={project.docs.length} onJump={() => onJump("docs")} />
      {rows.length === 0 ? <p className="wb-muted">{t("还没有资料文档")}</p> : (
        <ul className="wb-dash-rows">
          {rows.map((doc) => (
            <li key={doc.id}>
              <button type="button" className="wb-dash-row" onClick={() => open(doc)}>
                <span className="wb-dash-row-title" title={doc.title}>{doc.title}</span>
                <span className="wb-dash-meta">
                  {t(DOC_KIND_LABELS[doc.kind])} · {bytes(doc.size)} · {doc.updatedAt.slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview ? <WbImgView name={preview.name} url={preview.url} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}

function UpdateDash({ project, onJump }: { project: Project; onJump: () => void }) {
  const rows = [...project.updates].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  return (
    <section className="wb-info-card wb-dash">
      <DashHead label={t("进展")} count={project.updates.length} onJump={onJump} />
      {rows.length === 0 ? <p className="wb-muted">{t("还没有进展记录")}</p> : (
        <ul className="wb-update-list wb-dash-updates">
          {rows.map((update) => (
            <li key={update.id} className={`wb-update-row is-${update.kind}`}>
              <i className="wb-update-dot" aria-hidden />
              <div className="wb-update-body">
                <span className="wb-update-meta">{update.at.slice(0, 10)} · {t(UPDATE_KIND_LABELS[update.kind])}</span>
                <p>{update.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionDash({ project, onJump, onToast }: { project: Project; onJump: () => void; onToast: (message: string) => void }) {
  useHost(); /* 活会话表变化即重渲(运行中徽实时)。 */
  const hostSessions = host.getSessions();
  /* 行内「打开会话/查看转录」与会话页签同口径:workspaceId 必传(孤儿不收),
   * recent 供死关联找回(±5min 邻近判据在 sessionOpen)。 */
  const workspaceId = resolveWorkspaceId(useWorkspaces().list, project.cwd);
  const recent = useProjectSessions(project.cwd);
  const allLinks = collectLinkedSessions(project.tasks);
  const links = allLinks.slice(0, 3);
  return (
    <section className="wb-info-card wb-dash">
      <DashHead label={t("会话")} count={allLinks.length} onJump={onJump} />
      {links.length === 0 ? (
        <p className="wb-muted">{t("还没有任务关联的会话;在任务详情里「开新会话并关联」。")}</p>
      ) : (
        <ul className="wb-dash-rows">
          {links.map((link) => {
            /* 实时名/状态口径与「会话」页签一致:活会话命中行名跟随,终结回落快照。 */
            const live = hostSessions.find((s) => s.id === link.ref || s.cliSessionId === link.ref);
            const profileName = host.getCliProfile(link.profileId)?.name ?? link.profileId;
            return (
              <li key={link.ref}>
                <button type="button" className="wb-session-row wb-dash-session" onClick={() => openLink(link, project, workspaceId, onToast, recent)}>
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
    </section>
  );
}

/** 概要页 dashboard:2×2 四区块,行内顺序 = 任务/文档、进展/会话。 */
export function InfoDashboard({ project, today, onJump, onToast }: {
  project: Project;
  today: string;
  onJump: (tab: JumpTab, docId?: string) => void;
  onToast: (message: string) => void;
}) {
  return (
    <div className="wb-dash-grid">
      <TaskDash project={project} today={today} onJump={() => onJump("tasks")} />
      <DocDash project={project} onJump={onJump} onToast={onToast} />
      <UpdateDash project={project} onJump={() => onJump("updates")} />
      <SessionDash project={project} onJump={() => onJump("sessions")} onToast={onToast} />
    </div>
  );
}
