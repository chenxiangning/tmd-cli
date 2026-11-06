/**
 * 工作台 · 任务验收区(自 TaskDetailView 拆出守 300 行铁则):
 * - TaskCriteriaSec:完成判据清单(常显,验收对照面)。
 * - TaskAcceptanceSec:review 态验收 gate——通过收口 / 驳回回灌。驳回意见
 *   写进最新存活关联 host 会话续跑(sessions 头部即最新;点击时取
 *   host.getSessions() 现值,不依赖渲染快照),状态回 doing;无存活会话仅
 *   回滚并如实提示,不静默丢意见。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import { CheckCircle } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { prepareSendPayload } from "@kernel/profileSend";
import type { ProjectTask, TaskStatus } from "./types";

export function TaskCriteriaSec({ task }: { task: ProjectTask }) {
  if ((task.criteria ?? []).length === 0) return null;
  return (
    <section className="wb-taskdetail-sec">
      <h4>{t("完成判据")}</h4>
      <ol className="wb-task-criteria">
        {(task.criteria ?? []).map((c) => <li key={c.id}>{c.text}</li>)}
      </ol>
    </section>
  );
}

export function TaskAcceptanceSec({
  task, onToast, onStatus,
}: {
  task: ProjectTask;
  onToast: (message: string) => void;
  onStatus: (status: TaskStatus) => void;
}) {
  const [rejectText, setRejectText] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const rejectReview = () => {
    if (rejecting) return;
    const text = rejectText.trim();
    if (text === "") { onToast(t("驳回需填意见(将回灌给关联会话续跑)")); return; }
    setRejecting(true);
    const link = task.sessions.find((l) => l.kind === "host" && host.getSessions().some((s) => s.id === l.ref));
    const profile = link ? host.getCliProfile(link.profileId) : undefined;
    const send = link && profile
      ? host.writeSession(link.ref, prepareSendPayload({ ...profile, triggers: [] },
          `任务「${task.title}」验收驳回:${text}\n请针对意见继续推进;完成后再按完成判据逐条自检,并交付待验收(status 改回 review)。`))
          .then(() => onToast(t("驳回意见已回灌会话")), () => onToast(t("回灌发送失败")))
      : Promise.resolve(onToast(t("关联会话已不在:仅回滚状态,意见未送达")));
    void send.finally(() => {
      onStatus("doing");
      setRejectText("");
      setRejecting(false);
    });
  };
  return (
    <section className="wb-taskdetail-sec">
      <h4>{t("验收")}</h4>
      <p className="wb-muted">{t("AI 已声明交付待验收:对照判据与执行记录裁决。")}</p>
      <div className="wb-taskdetail-actions">
        <button type="button" className="wb-btn wb-btn-primary" onClick={() => onStatus("done")}>
          <CheckCircle size={12} />{t("通过并收口")}
        </button>
      </div>
      <textarea
        className="wb-doc-editor" rows={3}
        placeholder={t("驳回意见(必填,回灌给关联会话续跑)")}
        value={rejectText}
        onChange={(e) => setRejectText(e.target.value)}
      />
      <div className="wb-taskdetail-actions">
        <button type="button" className="wb-btn" onClick={rejectReview} disabled={rejecting}>{t("驳回并回灌会话")}</button>
      </div>
    </section>
  );
}
