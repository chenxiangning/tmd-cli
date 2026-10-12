/**
 * 后台任务面板(工具栏「后台任务」入口的全屏遮罩弹层)—— 进行中(可打开
 * 生成会话/终止,终止走 ConfirmDialog 强确认)/ 排队(可取消)/ 完成与失败
 * (可跳文章/重试,重试与删除均两击确认),面板展示最近 8 条;任务史落 meta.json
 * 截尾 50(taskQueue 通道)。
 */
import { useRef, useState } from "react";
import { ListChecks, TerminalWindow, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { DialogShell } from "@kernel/DialogShell";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import type { GenTask } from "./taskQueue";
import { cancelTask, enqueueTask, removeTask, useGenTasks } from "./taskQueue";
import { addBead } from "./journalStore";
import { hmNow } from "./timeUtil";
import { openArticleTab } from "./journalTabs";
import { EngMark } from "./EngMark";

/** 取消一枚任务(排队/运行皆可);定时族取消补「尝试过」珠防 15min 对表复活。 */
function cancelRow(task: GenTask): void {
  if (!cancelTask(task.id)) return;
  if (task.type === "定时生成" || task.type === "启动补跑" || task.type === "补齐生成") {
    addBead(task.dayKey, { t: hmNow(), label: `${task.type} · ${t("已取消")}` });
  }
}

/** 行内动作簇(自 TaskRow 拆出守复杂度):打开会话/终止取消/看文章/两击重试/两击删除。 */
function TaskRowActions({ task, arming, arm, disarm, onAskStop, openSession }: {
  task: GenTask;
  arming: "del" | "retry" | null;
  arm: (kind: "del" | "retry") => void;
  disarm: () => void;
  onAskStop: () => void;
  openSession: (() => void) | null;
}) {
  return (
    <div className="dj-ti-acts">
      {task.st === "run" && openSession && (
        <button type="button" className="dj-btn" onClick={openSession}>
          {/* 密集任务行小钮图标:10px 例外档 */}
          <TerminalWindow size="0.625rem" /> {t("打开会话")}
        </button>
      )}
      {(task.st === "queue" || task.st === "run") && (
        <button type="button" className="dj-btn" onClick={task.st === "run" ? onAskStop : () => cancelRow(task)}>
          {t(task.st === "run" ? "终止" : "取消")}
        </button>
      )}
      {task.st === "done" && (
        <button type="button" className="dj-btn" onClick={() => openArticleTab(Number(task.dayKey.slice(0, 4)), Number(task.dayKey.slice(5, 7)), Number(task.dayKey.slice(8, 10)))}>
          {t("看文章")}
        </button>
      )}
      {task.st === "err" && (
        <button
          type="button"
          className={`dj-btn${arming === "retry" ? " dj-btn-confirm" : ""}`}
          onClick={() => {
            /* 两击确认(与 MonthView/ArticleTab 删除同口径,C3):首击武装 3s。 */
            if (arming !== "retry") {
              arm("retry");
              return;
            }
            disarm();
            enqueueTask("重试生成", task.dayKey, task.engine);
          }}
        >
          {arming === "retry" ? t("再点一次确认重试") : t("重试")}
        </button>
      )}
      {(task.st === "done" || task.st === "err") && (
        <button
          type="button"
          className={`dj-btn${arming === "del" ? " dj-btn-confirm" : ""}`}
          aria-label={t("删除")}
          title={arming === "del" ? t("再点一次确认删除") : t("删除")}
          onClick={() => {
            if (arming !== "del") {
              arm("del");
              return;
            }
            disarm();
            removeTask(task.id);
          }}
        >
          {/* 密集任务行小钮图标:10px 例外档(同上) */}
          <X size="0.625rem" />
        </button>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: GenTask }) {
  const [m, d] = [Number(task.dayKey.slice(5, 7)), Number(task.dayKey.slice(8, 10))];
  /* 删除历史行两击确认(journal 内既有约定,MonthView/ArticleTab 同款):
   *  首击武装 3s 变 warn 色,再击才移除。失败「重试」同口径(C3);武装互斥。 */
  const [arming, setArming] = useState<"del" | "retry" | null>(null);
  const armTimer = useRef<number | null>(null);
  /* 终止运行中的生成会话 = 杀真实 CLI 会话(C3):ConfirmDialog 强确认,不做两击。 */
  const [askStop, setAskStop] = useState(false);
  const arm = (kind: "del" | "retry") => {
    setArming(kind);
    clearTimeout(armTimer.current!);
    armTimer.current = window.setTimeout(() => setArming(null), 3000);
  };
  const openSession = task.sessionId
    ? () => {
        host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
        host.setActiveSession(task.sessionId!);
      }
    : null;
  return (
    <div className={`dj-titem dj-titem-${task.st}`}>
      <div className="dj-ti-main">
        <div className="dj-ti-top">
          {m}/{d} · {t(task.type)}
          <EngMark id={task.engine} />
          {task.engine}
          {task.st === "run" && <span className="dj-ti-live">{t("后台运行中")}</span>}
        </div>
        <div className="dj-ti-sub">{t(task.text)}</div>
      </div>
      <TaskRowActions task={task} arming={arming} arm={arm} disarm={() => setArming(null)} onAskStop={() => setAskStop(true)} openSession={openSession} />
      {askStop && (
        <ConfirmDialog
          title={t("终止生成会话")}
          message={t("终止会杀掉真实 CLI 会话,未落盘的产出将丢失。确认终止?")}
          confirmLabel={t("终止")}
          danger
          onConfirm={() => cancelRow(task)}
          onClose={() => setAskStop(false)}
        />
      )}
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
      icon={<ListChecks size="0.875rem" />}
      width={600}
      onClose={onClose}
      footer={<span className="dj-tpanel-foot-text">{t("任务由 app 后台调度;生成会话是真实 CLI 会话,随时可打开插话干涉。")}</span>}
    >
      <div className="dj-modal-body dj-modal-body-flush">
          {run.length + queue.length + done.length === 0 && (
            /* 空态统一 Empty 形制(图标 + 一句话);说明文案沿用原句。 */
            <div className="dj-tpanel-empty">
              <Empty icon={<ListChecks size="0.875rem" />}>{t("暂无任务:生成会在后台排队执行,切走模块/失焦不中断。")}</Empty>
            </div>
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
              <div className="dj-tsec dj-tsec-row">
                <span>{t("排队")}</span>
                {queue.length > 1 && (
                  <button type="button" className="dj-btn" onClick={() => queue.forEach(cancelRow)}>
                    {t("全部取消")}
                  </button>
                )}
              </div>
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
