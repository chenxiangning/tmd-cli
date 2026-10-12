/**
 * 工作台 · 任务详情「关联会话」段(从 TaskDetailView 拆出守 300 行铁则):
 * 开新会话并关联 / 关联项目 cwd 最近会话 / 打开(聚焦或磁盘恢复)/ 解除关联。
 * 解除关联先经 WbConfirm 二次确认——只拆关联不动会话本身,但仍需防误点。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ChatCircle, X } from "@phosphor-icons/react";
import type { SessionMeta } from "@kernel/ipc";
import { unlinkTaskSession } from "./store";
import type { Project, ProjectTask, TaskSessionLink } from "./types";
import type { ProjectSessionsState } from "./useProjectSessions";
import { WbConfirm, WbSessionActs } from "./ui";
import { runIpc } from "./ipcToast";

export function TaskSessionsSec({ project, task, workspaceId, recent, hostSessions, onToast }: {
  project: Project;
  task: ProjectTask;
  workspaceId: string | undefined;
  recent: ProjectSessionsState | null;
  hostSessions: SessionMeta[];
  onToast: (message: string) => void;
}) {
  const [askUnlink, setAskUnlink] = useState<TaskSessionLink | null>(null);
  return (
    <section className="wb-taskdetail-sec">
      <div className="wb-sess-head">
        <h4>{t("关联会话")}<span className="wb-panel-sub">{task.sessions.length}</span></h4>
        {recent?.failed ? (
          <p className="wb-muted">
            {t("引擎会话扫描失败,列表可能不全。")}
            <button type="button" className="wb-link" onClick={recent.reload}>{t("重试")}</button>
          </p>
        ) : null}
      </div>
      <ul className="wb-attach-list">
        {task.sessions.map((link) => {
          /* 实时名/状态:host 注册表活会话优先(id 或磁盘身份命中);
           * CLI 自动改名后行名跟随,终结会话回落 link 快照。 */
          const live = hostSessions.find((s) => s.id === link.ref || s.cliSessionId === link.ref);
          const name = live?.title || link.title || link.ref;
          return (
            <li key={link.ref} className="wb-attach-row wb-sess-row">
              <span className="wb-attach-ico"><ChatCircle size={13} /></span>
              <span className="wb-attach-name">{name}</span>
              <span className="wb-attach-meta"><span className={live ? "wb-sess-status is-live" : "wb-sess-status is-done"}>{live ? t("运行中") : t("已完成")}</span> · {link.createdAt.slice(0, 10)}</span>
              <WbSessionActs link={link} project={project} workspaceId={workspaceId} recent={recent} live={live} onToast={onToast} />
              <button
                type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("解除关联")}
                onClick={() => setAskUnlink(link)}
              ><X size={11} /></button>
            </li>
          );
        })}
      </ul>
      <p className="wb-muted">{t("会话以 link 方式关联,不影响会话本身;发起时任务上下文(含附件清单)以卡片挂进该会话输入框,点卡片可编辑,随发送一并发出。")}</p>
      {askUnlink ? (
        <WbConfirm
          open
          title={t("解除关联")}
          body={t("将解除与会话「{title}」的关联;会话本身不受影响,之后仍可重新关联。", { title: askUnlink.title || askUnlink.ref })}
          confirmLabel={t("解除关联")}
          onConfirm={() => {
            runIpc(unlinkTaskSession(project.id, task.id, askUnlink.ref), onToast, t("已解除关联"));
            setAskUnlink(null);
          }}
          onCancel={() => setAskUnlink(null)}
        />
      ) : null}
    </section>
  );
}
