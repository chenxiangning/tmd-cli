/**
 * 后台任务面板(工具栏「后台任务」入口的全屏遮罩弹层)—— 进行中(可打开
 * 生成会话/终止)/ 排队(可取消)/ 完成与失败(可跳文章/重试),任务史截尾 50。
 */
import { ListChecks, TerminalWindow, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell } from "@kernel/DialogShell";
import { host } from "@kernel/host";
import { stringHue } from "@kernel/colorHash";
import type { GenTask } from "./taskQueue";
import { cancelTask, enqueueTask, removeTask, useGenTasks } from "./taskQueue";
import { addBead } from "./journalStore";
import { hmNow } from "./timeUtil";
import { openArticleTab } from "./journalTabs";

function TaskRow({ task }: { task: GenTask }) {
  const [y, m, d] = [Number(task.dayKey.slice(0, 4)), Number(task.dayKey.slice(5, 7)), Number(task.dayKey.slice(8, 10))];
  const openSession = task.sessionId ? () => host.setActiveSession(task.sessionId!) : null;
  return (
    <div className={`dj-titem dj-titem-${task.st}`}>
      <div className="dj-ti-main">
        <div className="dj-ti-top">
          {m}/{d} · {t(task.type)}
          <i className="dj-ti-eng" style={{ background: `hsl(${stringHue(task.engine)} 52% 48%)` }} />
          {task.engine}
          {task.st === "run" && <span className="dj-ti-live">{t("后台运行中")}</span>}
        </div>
        <div className="dj-ti-sub">{task.text}</div>
      </div>
      <div className="dj-ti-acts">
        {task.st === "run" && openSession && (
          <button type="button" className="dj-btn" onClick={openSession}>
            <TerminalWindow size={10} /> {t("打开会话")}
          </button>
        )}
        {(task.st === "queue" || task.st === "run") && (
          <button
            type="button"
            className="dj-btn"
            onClick={() => {
              if (cancelTask(task.id) && (task.type === "定时生成" || task.type === "启动补跑" || task.type === "补齐生成")) {
                /* 定时族取消也落「尝试过」珠:防 15min 对表无限复活(B4 评审 P2-2)。 */
                addBead(task.dayKey, { t: hmNow(), label: `${task.type} · 已取消` });
              }
            }}
          >
            {t(task.st === "run" ? "终止" : "取消")}
          </button>
        )}
        {task.st === "done" && (
          <button type="button" className="dj-btn" onClick={() => openArticleTab(y, m, d)}>
            {t("看文章")}
          </button>
        )}
        {task.st === "err" && (
          <button
            type="button"
            className="dj-btn"
            onClick={() => {
              enqueueTask("重试生成", task.dayKey, task.engine);
            }}
          >
            {t("重试")}
          </button>
        )}
        {(task.st === "done" || task.st === "err") && (
          <button
            type="button"
            className="dj-btn"
            aria-label={t("删除")}
            title={t("删除")}
            onClick={() => {
              removeTask(task.id);
            }}
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}


export function TaskPanel({ onClose }: { onClose: () => void }) {
  const tasks = useGenTasks();
  const run = tasks.filter((x) => x.st === "run");
  const queue = tasks.filter((x) => x.st === "queue");
  const done = tasks.filter((x) => x.st === "done" || x.st === "err").slice(0, 8);
  return (
    <DialogShell
      title={t("后台任务 · 生成队列")}
      icon={<ListChecks size={13} />}
      width={600}
      onClose={onClose}
      footer={<span className="dj-tpanel-foot-text">{t("任务由 app 后台调度;生成会话是真实 CLI 会话,随时可打开插话干涉。")}</span>}
    >
      <div className="dj-modal-body dj-modal-body-flush">
          {run.length + queue.length + done.length === 0 && (
            <div className="dj-tpanel-empty">{t("暂无任务:生成会在后台排队执行,切走模块/失焦不中断。")}</div>
          )}
          {run.length > 0 && (
            <>
              <div className="dj-tsec">{t("进行中(切走模块 / 失焦不中断)")}</div>
              {run.map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </>
          )}
          {queue.length > 0 && (
            <>
              <div className="dj-tsec">{t("排队")}</div>
              {queue.map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="dj-tsec">{t("完成 / 失败")}</div>
              {done.map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </>
          )}
        </div>
    </DialogShell>
  );
}
