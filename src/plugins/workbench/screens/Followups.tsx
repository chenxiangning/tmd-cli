/**
 * 工作台 · 待跟进视图:未完成任务按 已逾期/今天到期/本周内/更晚/未排期 分桶,
 * 行内勾完成 / 移进行中。
 */

import { t } from "@kernel/i18n";
import { followUpBuckets } from "../followUpBuckets";
import { deleteTask, updateTask } from "../store";
import { runIpc } from "../ipcToast";
import { toneVar } from "../tone";
import { WbEmpty } from "../ui";
import type { WbScreenProps } from "./cards";

export function FollowupsScreen({ projects, today, onOpen, onToast }: WbScreenProps) {
  const buckets = followUpBuckets(projects, today);
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  if (total === 0) return <WbEmpty text={t("没有未完成任务,清清爽爽。")} />;
  return (
    <div className="wb-followups">
      {buckets.map((bucket) => (
        <section key={bucket.key} className="wb-bucket">
          <h3 className="wb-bucket-head" style={{ color: toneVar(bucket.tone) }}>
            <b>{t(bucket.label)}</b><span>{bucket.total}</span>
          </h3>
          {bucket.items.length === 0 ? <p className="wb-muted">—</p> : bucket.items.map((item) => (
            <div key={item.key} className="wb-bucket-row">
              <label className="wb-bucket-check">
                <input
                  type="checkbox"
                  aria-label={t("完成任务")}
                  onChange={() => runIpc(updateTask(item.projectId, item.taskId, { status: "done" }), onToast, t("任务已更新"))}
                />
              </label>
              <span className="wb-bucket-body">
                <span className="wb-bucket-title">{item.title}</span>
                <span className="wb-bucket-meta">
                  <button type="button" className="wb-link" onClick={() => onOpen(item.projectId)}>{item.projectName}</button>
                  {item.owner ? <span>{item.owner}</span> : null}
                  {item.dueDate ? <span>{item.dueDate}</span> : null}
                  {item.overdueDays > 0 ? <span className="wb-overdue">{t("逾期 {n} 天", { n: item.overdueDays })}</span> : null}
                </span>
              </span>
              <span className="wb-task-actions">
                {bucket.key === "overdue" || bucket.key === "today" || bucket.key === "week" ? (
                  <button
                    type="button" className="wb-btn wb-btn-xs"
                    onClick={() => runIpc(updateTask(item.projectId, item.taskId, { status: "doing" }), onToast, t("任务已更新"))}
                  >{t("进行")}</button>
                ) : null}
                <button
                  type="button" className="wb-btn wb-btn-xs" aria-label={t("删除")}
                  onClick={() => runIpc(deleteTask(item.projectId, item.taskId), onToast, t("任务已删除"))}
                >×</button>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
