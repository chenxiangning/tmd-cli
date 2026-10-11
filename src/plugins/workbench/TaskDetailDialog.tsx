/**
 * 工作台 · 任务详情弹层(参考禅道任务详情,单栏自适应布局):
 * 描述(markdown 纯文本可编辑)+ 附件(上传/预览/删除)+ 关联会话
 * (开新会话/关联项目 cwd 最近会话/打开/解除)+ 右侧基本信息与状态切换。
 * 会话 link-only:host=活会话聚焦(失败兜底磁盘恢复),disk=磁盘恢复。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ChatCircle, Plus, X } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { DialogShell } from "@kernel/DialogShell";
import { TASK_STATUS_LABELS } from "./kindLabels";
import {
  attachTaskFile, detachTaskFile, linkTaskSession, unlinkTaskSession, updateTask,
} from "./store";
import { composerReplaceRef, queueComposerText } from "@kernel/composerExt";
import { readDocDataUrl, fileToBase64, isImageAttachment, docAttachmentPath } from "./workbenchFiles";
import { openFileInTab } from "@kernel/fileTabs";
import { TASK_STATUSES, type Attachment, type Project, type ProjectTask, type TaskStatus } from "./types";
import { useProjectSessions } from "./useProjectSessions";
import { resolveWorkspaceId } from "./views";
import { WbBadge, WbImgView, WbAttachmentSection } from "./ui";
import { taskPrompt } from "./taskPrompt";
import { runIpc } from "./ipcToast";
import { openLink } from "./sessionOpen";

export function TaskDetailDialog({
  project, task, onClose, onToast,
}: {
  project: Project;
  task: ProjectTask;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  /* task 来自快照,弹层内编辑基于本地 draft(保存走 store,onChange 后父级换新快照)。 */
  const [description, setDescription] = useState(task.description ?? "");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const recent = useProjectSessions(project.cwd);
  useHost(); /* 活会话表变化即重渲(关联行实时名/状态徽)。 */
  const hostSessions = host.getSessions();
  /* cwd → 工作区 id:会话挂树必带,孤儿会话侧栏不收(精确命中,子目录取最深前缀)。 */
  const workspaceId = resolveWorkspaceId(useWorkspaces().list, project.cwd);
  /* 任务切换由调用方 key={task.id} 重挂复位,不写 prop→state 同步 effect。 */

  /* 快照经 useSyncExternalStore 已自动刷新,onChanged 桥是死的(2026-10-11 review 清除)。 */
  const setStatus = (status: TaskStatus) => runIpc(updateTask(project.id, task.id, { status }), onToast, t("任务已更新"));
  const saveDescription = () =>
    /* 成功才清 dirty:失败保留脏标记,保存钮可重试(吞错后仍清 = 按钮禁死)。 */
    void updateTask(project.id, task.id, { description }).then(
      () => { onToast(t("描述已保存")); setDirty(false); },
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  const upload = async (file: File) => {
    if (file.size > 24 * 1024 * 1024) {
      onToast(t("附件超过 24MB 上限"));
      return;
    }
    let bytesBase64: string; let size: number;
    try {
      ({ bytesBase64, size } = await fileToBase64(file));
    } catch {
      onToast(t("附件打开失败"));
      return;
    }
    void attachTaskFile(project.id, task.id, { name: file.name, bytesBase64, size }).then(
      () => onToast(t("附件已上传")),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const previewAttachment = (att: Attachment) => {
    if (!isImageAttachment(att.fileName)) {
      void docAttachmentPath(project.id, att.fileName).then((p) => openFileInTab(p, att.name)).catch(() => onToast(t("附件打开失败")));
      return;
    }
    void readDocDataUrl(project.id, att.fileName).then(
      (url: string | null) => {
        if (url) setPreview({ name: att.name, url });
        else onToast(t("附件读取失败"));
      },
      () => onToast(t("附件读取失败")),
    );
  };
  const startLinked = () => {
    if (!project.cwd) {
      onToast(t("项目未绑定目录;先在「编辑」里填 cwd 再开会话"));
      return;
    }
    const profileId = recent?.[0]?.profileId;
    if (!profileId) {
      onToast(t("该目录暂无可用引擎会话,请先在侧栏开过一次"));
      return;
    }
    const promptText = taskPrompt(project, task);
    void host.createSession(profileId, project.cwd, workspaceId).then(
      (meta) => {
        host.setActiveSession(meta.id);
        /* 常驻 composer 不随会话切换重挂载,mount 期消费队列的时机不存在
         * (真机二轮实测)。主路径 = activation 提交后经 replace 桥整替——
         * 120ms 等 React commit(含 cwd 草稿切换的 setValue)先行,避免被
         * 旧草稿覆盖;无消费方( composer 未挂载)才落队列,TTL 兜底。 */
        window.setTimeout(() => {
          if (composerReplaceRef.current) composerReplaceRef.current(promptText);
          else queueComposerText(promptText);
        }, 120);
        void linkTaskSession(project.id, task.id, { kind: "host", ref: meta.id, profileId, title: task.title })
          .catch(() => undefined);
      },
      () => onToast(t("创建会话失败")),
    );
  };

  return (
    <DialogShell
      title={task.title}
      icon={null}
      width={860}
      cardClass="wb-task-shell"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" className="wb-btn" onClick={onClose}>{t("关闭")}</button>
        </div>
      }
    >
      <div className="wb-taskdetail">
        <div className="wb-taskdetail-main">
          <section className="wb-taskdetail-sec">
            <h4>{t("描述")}</h4>
            <textarea
              className="wb-doc-editor" rows={6}
              placeholder={t("任务目标、验收标准、相关链接…")}
              value={description}
              onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
            />
            {dirty ? (
              <div className="wb-taskdetail-actions">
                <button type="button" className="wb-btn wb-btn-primary" onClick={saveDescription}>{t("保存描述")}</button>
              </div>
            ) : null}
          </section>
          <WbAttachmentSection
            items={task.attachments}
            onUpload={upload}
            onOpen={previewAttachment}
            onDelete={(att) => detachTaskFile(project.id, task.id, att.id)}
            onToast={onToast}
          />
          <section className="wb-taskdetail-sec">
            <h4>{t("关联会话")}<span className="wb-panel-sub">{task.sessions.length}</span></h4>
            <div className="wb-taskdetail-actions">
              <button type="button" className="wb-btn wb-btn-primary" onClick={startLinked}>
                <Plus size={12} />{t("开新会话并关联")}
              </button>
              {recent && recent.length > 0 ? (
                <select
                  aria-label={t("关联已有会话")} defaultValue=""
                  onChange={(e) => {
                    const row = recent.find((item) => item.key === e.target.value);
                    if (row) runIpc(linkTaskSession(project.id, task.id, { kind: "disk", ref: row.cliSessionId, profileId: row.profileId, title: row.title }), onToast, t("已关联会话"));
                    e.target.value = "";
                  }}
                >
                  <option value="">{t("关联已有会话…")}</option>
                  {recent.map((row) => <option key={row.key} value={row.key}>{row.title.slice(0, 40)}({row.profileName})</option>)}
                </select>
              ) : null}
            </div>
            <ul className="wb-attach-list">
              {task.sessions.map((link) => {
                /* 实时名/状态:host 注册表活会话优先(id 或磁盘身份命中);
                 * CLI 自动改名后行名跟随,终结会话回落 link 快照。 */
                const live = hostSessions.find((s) => s.id === link.ref || s.cliSessionId === link.ref);
                const name = live?.title || link.title || link.ref;
                return (
                  <li key={link.ref} className="wb-attach-row">
                    <span className="wb-attach-ico"><ChatCircle size={13} /></span>
                    <button type="button" className="wb-link" onClick={() => openLink(link, project, workspaceId, onToast)}>{name}</button>
                    <span className={`wb-attach-meta${live ? " wb-session-live" : ""}`}>{live ? t("运行中") : t("已完成")} · {link.createdAt.slice(0, 10)}</span>
                    <button
                      type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("解除关联")}
                      onClick={() => runIpc(unlinkTaskSession(project.id, task.id, link.ref), onToast, t("已解除关联"))}
                    ><X size={11} /></button>
                  </li>
                );
              })}
            </ul>
            <p className="wb-muted">{t("会话以 link 方式关联,不影响会话本身;发起时任务上下文(含附件清单)会自动填入该会话输入框。")}</p>
          </section>
        </div>
        <aside className="wb-taskdetail-side">
          <h4>{t("基本信息")}</h4>
          <WbBadge tone={task.status === "done" ? "ok" : task.status === "doing" ? "info" : "muted"}>{t(TASK_STATUS_LABELS[task.status])}</WbBadge>
          <label className="wb-field">
            <span>{t("状态")}</span>
            <select value={task.status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((status) => <option key={status} value={status}>{t(TASK_STATUS_LABELS[status])}</option>)}
            </select>
          </label>
          <div className="wb-info-row"><span className="wb-info-label">{t("负责人")}</span><span className="wb-info-value">{task.owner || "—"}</span></div>
          <div className="wb-info-row"><span className="wb-info-label">{t("开始")}</span><span className="wb-info-value">{task.startedOn ?? "—"}</span></div>
          <div className="wb-info-row"><span className="wb-info-label">{t("截止")}</span><span className="wb-info-value">{task.dueDate ?? "—"}</span></div>
          <div className="wb-info-row"><span className="wb-info-label">{t("所属项目")}</span><span className="wb-info-value">{project.name}</span></div>
          <div className="wb-info-row"><span className="wb-info-label">{t("绑定目录")}</span><span className="wb-info-value" title={project.cwd ?? ""}>{project.cwd ?? t("未绑定")}</span></div>
        </aside>
      </div>
      {preview ? <WbImgView name={preview.name} url={preview.url} onClose={() => setPreview(null)} /> : null}
    </DialogShell>
  );
}
