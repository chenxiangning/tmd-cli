/**
 * 工作台 · 聚焦页(三撤一合:项目列表/时间线/待跟进 → 单页签)。
 * 三段 = 要处理(前三桶展开 + 更晚/未排期折叠)→ 接下来 14 天(DDL chip + 密度徽标)
 * → 项目脉搏(活动流行 + 空壳折叠索引);清净态给下一步不装忙。
 * 数据模型全在 ../focusModel.ts(纯函数);本文只渲染与用户手势。
 * 设计:docs/superpowers/specs/2026-10-12-workbench-focus-view-design.md
 */

import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { CaretRight, ChatCircle, Plus, X } from "@phosphor-icons/react";
import { useWorkspaces, type Workspace } from "@kernel/workspace";
import { NEXT_TASK_STATUS, type Project } from "../types";
import { deleteTask, updateTask } from "../store";
import { runIpc } from "../ipcToast";
import { toneVar } from "../tone";
import { WbBadge, WbConfirm, WbEmpty } from "../ui";
import { RISK_LABELS } from "../insights";
import { TASK_ADVANCE_LABELS } from "../kindLabels";
import { resolveWorkspaceId } from "../views";
import { createSessionHere, openLink } from "../sessionOpen";
import { useProjectSessions } from "../useProjectSessions";
import {
  focusBand, focusBuckets, focusLine, pulsePartition,
  type PulseRow,
} from "../focusModel";
import type { FollowUpItem } from "../followUpBuckets";
import { FocusBandSection, GhostIndex, PulseActivity } from "./FocusParts";
import type { WbScreenProps } from "./cards";

export function FocusScreen({ allProjects, today, onOpen, onNewProject, onToast, onTab, onNewTask }: WbScreenProps) {
  const { list: workspaces } = useWorkspaces();
  const buckets = useMemo(() => focusBuckets(allProjects, today), [allProjects, today]);
  const band = useMemo(() => focusBand(allProjects, today), [allProjects, today]);
  const pulse = useMemo(() => pulsePartition(allProjects, today), [allProjects, today]);
  const line = useMemo(() => focusLine(buckets, pulse), [buckets, pulse]);
  const projectsById = useMemo(() => Object.fromEntries(allProjects.map((p) => [p.id, p])), [allProjects]);
  const [laterOpen, setLaterOpen] = useState(false);
  const [askDelete, setAskDelete] = useState<FollowUpItem | null>(null);
  if (allProjects.length === 0) {
    return <WbEmpty text={t("还没有项目。")}><button type="button" className="wb-btn" onClick={onNewProject}>{t("新建项目")}</button></WbEmpty>;
  }
  const rowCtx = { workspaces, projectsById, onOpen, onToast, onAskDelete: setAskDelete };
  const clauses = [
    line.overdue > 0 ? t("{count} 条逾期", { count: line.overdue }) : "",
    line.dueToday > 0 ? t("{count} 条今天到期", { count: line.dueToday }) : "",
  ].filter(Boolean).join(t("、"));
  return (
    <div className="wb-focus">
      <p className="wb-focus-line">
        {line.calm
          ? (line.topName ? t("今天清净:没有到期任务,最近活跃在 {name}。", { name: line.topName }) : t("今天清净:没有到期任务。"))
          : t("今天 {clauses},{active} 个项目活跃。", { clauses, active: line.active })}
      </p>

      <section className="wb-focus-sec">
        <h3 className="wb-focus-sec-head">{t("要处理")}</h3>
        {line.calm ? (
          <div className="wb-focus-calm">
            <p className="wb-focus-calm-t">{t("没有逾期、今天或本周到期的任务")}</p>
            <p className="wb-muted">{t("今天属于主线工作。想去排一排,或补一条任务?")}</p>
            <div className="wb-empty-actions">
              <button type="button" className="wb-btn" onClick={() => onTab?.("board")}>{t("去任务看板")}</button>
              <button type="button" className="wb-btn" onClick={() => onNewTask?.()}>{t("新建任务")}</button>
            </div>
          </div>
        ) : (
          <div className="wb-focus-groups">
            {buckets.main.filter((bucket) => bucket.items.length > 0).map((bucket) => (
              <div key={bucket.key} className="wb-focus-group">
                <h4 className="wb-focus-bucket-head" style={{ color: toneVar(bucket.tone) }}>
                  <b>{t(bucket.label)}</b><span>{bucket.total}</span>
                </h4>
                {bucket.items.map((item) => <FocusTaskRow key={item.key} item={item} {...rowCtx} />)}
              </div>
            ))}
          </div>
        )}
        {buckets.later.length > 0 ? (
          <div className="wb-focus-later">
            <button type="button" className="wb-focus-strip" aria-expanded={laterOpen} onClick={() => setLaterOpen((v) => !v)}>
              <CaretRight size={9} className={laterOpen ? "is-open" : undefined} />
              {t("更晚与未排期")}<span>{buckets.later.length}</span>
            </button>
            {laterOpen ? buckets.later.map((item) => <FocusTaskRow key={item.key} item={item} {...rowCtx} />) : null}
          </div>
        ) : null}
      </section>

      <FocusBandSection band={band} onOpen={onOpen} />

      <section className="wb-focus-sec">
        <h3 className="wb-focus-sec-head">{t("项目脉搏")}</h3>
        {pulse.rows.length === 0 ? <p className="wb-muted">{t("没有被跟踪的项目;空壳全部沉底在下方索引。")}</p> : (
          <div className="wb-focus-pulse">
            {pulse.rows.map((row) => (
              <PulseRowView key={row.project.id} row={row} today={today} onOpen={onOpen} onToast={onToast} />
            ))}
          </div>
        )}
        {pulse.ghosts.length > 0 ? <GhostIndex ghosts={pulse.ghosts} onOpen={onOpen} /> : null}
      </section>

      {askDelete ? (
        <WbConfirm
          open
          title={t("删除任务")}
          body={t("将删除任务「{title}」及其附件,不可恢复。", { title: askDelete.title })}
          confirmLabel={t("删除")}
          onConfirm={() => {
            runIpc(deleteTask(askDelete.projectId, askDelete.taskId), onToast, t("任务已删除"));
            setAskDelete(null);
          }}
          onCancel={() => setAskDelete(null)}
        />
      ) : null}
    </div>
  );
}

/** 要处理行(三桶与更晚折叠共用):勾完成 / 项目 chip / 会话直达 / 推进 / 删除。 */
function FocusTaskRow({ item, workspaces, projectsById, onOpen, onToast, onAskDelete }: {
  item: FollowUpItem;
  workspaces: readonly Workspace[];
  projectsById: Record<string, Project>;
  onOpen: (id: string) => void;
  onToast: (message: string) => void;
  onAskDelete: (item: FollowUpItem) => void;
}) {
  const next = NEXT_TASK_STATUS[item.status];
  const openSession = () => {
    const project = projectsById[item.projectId];
    const link = item.sessions[item.sessions.length - 1];
    if (!project || !link) return;
    openLink(link, project, resolveWorkspaceId(workspaces, project.cwd), onToast);
  };
  return (
    <div className="wb-focus-row">
      <label className="wb-bucket-check">
        <input
          type="checkbox"
          aria-label={t("完成任务:{title}", { title: item.title })}
          onChange={() => runIpc(updateTask(item.projectId, item.taskId, { status: "done" }), onToast, t("任务已更新"))}
        />
      </label>
      <span className="wb-bucket-body">
        <span className="wb-bucket-title">{item.title}</span>
        <span className="wb-bucket-meta">
          <button type="button" className="wb-link" onClick={() => onOpen(item.projectId)}>{item.projectName}</button>
          {item.dueDate ? <span>{item.dueDate.slice(5)}</span> : null}
          {item.overdueDays > 0 ? <span className="wb-overdue">{t("逾期 {n} 天", { n: item.overdueDays })}</span> : null}
        </span>
      </span>
      <span className="wb-task-actions">
        {item.sessions.length > 0 ? (
          <button type="button" className="wb-sess-pill" title={t("打开最近关联会话")} onClick={openSession}>
            <ChatCircle size={11} />{t("会话 ×{count}", { count: item.sessions.length })}
          </button>
        ) : null}
        {next ? (
          <button
            type="button" className="wb-btn wb-btn-xs"
            onClick={() => runIpc(updateTask(item.projectId, item.taskId, { status: next }), onToast, t("任务已更新"))}
          >{t(TASK_ADVANCE_LABELS[next] ?? "开始")}</button>
        ) : null}
        <button type="button" className="wb-btn wb-btn-xs" aria-label={t("删除:{title}", { title: item.title })} onClick={() => onAskDelete(item)}><X size={11} /></button>
      </span>
    </div>
  );
}

/** 脉搏行:项目名 + 手工进度微条(弱信号)/ 风险徽标 / 截止 / 未完数 / 最近活动 / 详情+开会话。 */
function PulseRowView({ row, today, onOpen, onToast }: {
  row: PulseRow;
  today: string;
  onOpen: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const { project } = row;
  const { list: workspaces } = useWorkspaces();
  const recent = useProjectSessions(project.cwd);
  const [creating, setCreating] = useState(false);
  return (
    <div className="wb-pulse-row">
      <span className="wb-pulse-name">
        <button type="button" className="wb-pulse-namebtn" onClick={() => onOpen(project.id)}>{project.name}</button>
        <span className="wb-pulse-mini" title={t("手工进度 {value}%(弱信号,以活动流为准)", { value: project.progress })}>
          <i style={{ width: `${project.progress}%` }} />
        </span>
      </span>
      <WbBadge tone={row.tone}>{t(RISK_LABELS[row.riskLevel])}</WbBadge>
      <span className="wb-pulse-due">{project.dueDate ? t("{date} 截止", { date: project.dueDate.slice(5) }) : "—"}</span>
      <span className="wb-pulse-open">{t("未完 {count}", { count: row.open })}</span>
      <span className="wb-pulse-act">
        <PulseActivity row={row} today={today} />
      </span>
      <span className="wb-pulse-actions">
        <button type="button" className="wb-btn wb-btn-xs" onClick={() => onOpen(project.id)}>{t("详情")}</button>
        <button
          type="button" className="wb-btn wb-btn-xs" disabled={creating || !project.cwd}
          title={project.cwd ? undefined : t("项目未绑定目录,无法恢复磁盘会话")}
          onClick={() => {
            setCreating(true);
            createSessionHere(project, resolveWorkspaceId(workspaces, project.cwd), recent, onToast, () => setCreating(false));
          }}
        ><Plus size={11} />{t("开会话")}</button>
      </span>
    </div>
  );
}

