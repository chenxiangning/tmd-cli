/**
 * docgen 文档中心 —— 工作台「文档」页签:左列(排程卡 + 今天/更早分组列表)
 * + 右栏阅读器。数据源 useDocGenEntries / useDocGenTasks / useDocGenSchedule;
 * 深链 projectFilter(项目详情「本项目生成记录」)经 screenProps.docsFilter 注入。
 */
import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { X } from "@phosphor-icons/react";
import { WbScreenProps } from "./screens/cards";
import { useDocGenEntries, useDocGenSchedule, updateSchedule, toggleDocState } from "./docgen/store";
import { cancelDocGenTask, useDocGenTasks } from "./docgen/queue";
import { DOC_STATE_KEYS, groupEntries, rowMeta, statusChip } from "./docgenView";
import { getDocGenTemplate } from "./docgen/templates";
import { scheduleFireDue } from "./docgen/schedule";
import { DocGenReader } from "./docgen/DocGenReader";
import type { DocGenEntry, DocGenSchedule } from "./docgen/types";
import type { DocGenTask } from "./docgen/queue";

export function DocGenCenter(screenProps: WbScreenProps) {
  const { projects, today, onToast, docsFilter, onDocGen } = screenProps;
  const entries = useDocGenEntries();
  const tasks = useDocGenTasks();
  const schedule = useDocGenSchedule();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState(0);

  const visible = useMemo(
    () => (docsFilter ? entries.filter((e) => e.scope.kind === "one" && e.scope.projectId === docsFilter) : entries),
    [entries, docsFilter],
  );
  /* 选中自愈:渲染期调整(当前选中消失或未选时落首行)。 */
  if (lastCount !== visible.length || (selectedId !== null && !visible.some((e) => e.id === selectedId))) {
    setLastCount(visible.length);
    if (visible.length > 0 && (selectedId === null || !visible.some((e) => e.id === selectedId))) {
      setSelectedId(visible[0].id);
    }
  }

  const selected = visible.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="dg-hub">
      <DocList
        visible={visible}
        tasks={tasks}
        schedule={schedule}
        today={today}
        docsFilter={docsFilter}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDocGen={onDocGen}
        onToast={onToast}
      />
      <section className="dg-main">
        {selected ? (
          <DocGenReader key={selected.id} entry={selected} projects={projects} onToast={onToast} />
        ) : (
          <div className="dg-empty-main">
            <p>{t("从左侧选择一份文档")}</p>
            <p className="dg-muted">{t("或点顶栏「生成文档」创建:模板 × 事实源 × 周期,真实 CLI 会话无头生成后结构化落盘。")}</p>
            {onDocGen ? (
              <button type="button" className="wb-btn wb-btn-primary" onClick={() => onDocGen(docsFilter ?? undefined)}>
                {t("生成文档")}
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function DocList({ visible, tasks, schedule, today, docsFilter, selectedId, onSelect, onDocGen, onToast }: {
  visible: DocGenEntry[];
  tasks: DocGenTask[];
  schedule: DocGenSchedule;
  today: string;
  docsFilter?: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDocGen?: (projectId?: string) => void;
  onToast: (m: string) => void;
}) {
  const grouped = groupEntries(visible, today);
  const taskByEntry = new Map(tasks.filter((x) => x.st === "queue" || x.st === "run").map((x) => [x.entryId, x]));
  const monthCount = visible.filter((e) => e.updatedAt.slice(0, 7) === today.slice(0, 7)).length;
  const rows = (list: DocGenEntry[]) =>
    list.map((entry) => (
      <ListRow key={entry.id} entry={entry} task={taskByEntry.get(entry.id)} selected={entry.id === selectedId}
        onSelect={() => onSelect(entry.id)} onCancel={() => {
          /* 终止按 cancelDocGenTask 返回值如实提示(排队取消不收割会话,文案分口径)。 */
          const x = taskByEntry.get(entry.id);
          if (!x || !cancelDocGenTask(x.id)) {
            onToast(t("任务已结束,无需终止"));
            return;
          }
          onToast(x.st === "run" ? t("已终止:收割会话并回落") : t("已取消排队任务"));
        }} />
    ));
  return (
    <aside className="dg-list">
      <div className="dg-list-head">
        <span>{docsFilter ? t("本项目生成记录") : t("文档中心")}</span>
        <span className="dg-count">
          {t("本月 {n} 份", { n: String(monthCount) })} · {schedule.on ? t("排程运行中") : t("排程关闭")}
        </span>
      </div>
      <ScheduleCard schedule={schedule} onToast={onToast} />
      {visible.length === 0 ? (
        <p className="dg-empty">
          {docsFilter ? t("本项目还没有生成记录;在概要页点「生成文档…」") : t("还没有生成记录;点顶栏「生成文档」开始")}
          {onDocGen ? (
            <button type="button" className="wb-btn wb-btn-primary dg-empty-cta" onClick={() => onDocGen(docsFilter ?? undefined)}>
              {t("生成文档")}
            </button>
          ) : null}
        </p>
      ) : null}
      {grouped.today.length > 0 ? <div className="dg-group">{t("今天")}</div> : null}
      {rows(grouped.today)}
      {grouped.earlier.length > 0 ? <div className="dg-group">{t("更早")}</div> : null}
      {rows(grouped.earlier)}
    </aside>
  );
}

/* E5:七日全量,0/6 手改数据不再显示空星期(旧空串占位导致「每周 09:00」缺星期)。 */
const WEEKDAY_LABELS: readonly string[] = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function ScheduleCard({ schedule, onToast }: {
  schedule: DocGenSchedule;
  onToast: (m: string) => void;
}) {
  /* C6 toggle pending:在途禁用防连点乱序(连续 toggle 落盘顺序不保证,以禁用串行化)。 */
  const [pending, setPending] = useState(false);
  const toggleSchedule = () => {
    if (pending) return;
    setPending(true);
    void updateSchedule({ on: !schedule.on }).finally(() => setPending(false)).then(
      () => onToast(schedule.on ? t("排程已暂停") : t("排程已开启:{next}", { next: `${t(WEEKDAY_LABELS[schedule.weekday] ?? "")} ${schedule.time}` })),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const nextRun = schedule.on ? `${t(WEEKDAY_LABELS[schedule.weekday] ?? "周五")} ${schedule.time}` : null;
  const scheduleDue = schedule.on && scheduleFireDue(new Date(), schedule);
  const tpl = getDocGenTemplate(schedule.templateId);
  return (
    <div className="dg-schedcard">
      <div className="dg-sched-row">
        <i className={`dg-dot ${schedule.on ? "dg-dot-sched" : "dg-dot-off"}`} />
        <b>{t("每周{wd} {time} · {template}", { wd: t(WEEKDAY_LABELS[schedule.weekday] ?? "周五"), time: schedule.time, template: tpl ? t(tpl.label) : schedule.templateId })}</b>
        <span className={`dg-chip ${schedule.on ? "dg-chip-sched" : "dg-chip-off"}`}>{schedule.on ? t("运行中") : t("已暂停")}</span>
        <button type="button" className="wb-btn wb-btn-xs" disabled={pending} onClick={toggleSchedule}>
          {schedule.on ? t("暂停") : t("开启排程")}
        </button>
      </div>
      <p className="dg-sched-meta">
        {schedule.on
          ? t("下次 {next} · {engine}", { next: nextRun ?? "—", engine: schedule.engine }) + (scheduleDue ? ` · ${t("本周待补跑")}` : "")
          : t("排程关闭,仅手动生成")}
      </p>
    </div>
  );
}

function ListRow({ entry, task, selected, onSelect, onCancel }: {
  entry: DocGenEntry;
  task?: DocGenTask;
  selected: boolean;
  onSelect: () => void;
  onCancel: () => void;
}) {
  const chip = statusChip(entry, task);
  return (
    <div className={`dg-row${selected ? " is-on" : ""} dg-row-${chip.cls}`}>
      <button type="button" className="dg-row-main" onClick={onSelect}>
        <span className="dg-row-top">
          <i className={`dg-dot dg-dot-${chip.cls}`} />
          <span className="dg-row-title">{entry.title}</span>
          <span className={`dg-chip dg-chip-${chip.cls}`}>{chip.text}</span>
        </span>
        <span className="dg-row-meta">{rowMeta(entry)}</span>
      </button>
      {entry.status === "done" ? (
        <button
          type="button"
          className={`dg-stt dg-stt-${entry.docState}`}
          title={t("点击立即流转:草稿 → 已汇报 → 已归档(单击即生效)")}
          onClick={(e) => { e.stopPropagation(); void toggleDocState(entry.id); }}
        >
          {t(DOC_STATE_KEYS[entry.docState])}
        </button>
      ) : null}
      {chip.cls === "gen" ? (
        <button type="button" className="dg-row-stop" aria-label={t("终止")} onClick={onCancel}><X size={11} /></button>
      ) : null}
    </div>
  );
}
