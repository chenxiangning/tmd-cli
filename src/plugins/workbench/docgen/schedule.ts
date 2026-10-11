/**
 * docgen 定时排程 —— 每周 weekday HH:MM 生成一次周报类文档。
 * 幂等闸 = docgen.json schedule.lastWeekKey(持久,boot 补跑与 tick 共用);
 * 运行期 15 分钟对表 + boot 补跑(错过 appointment 当周仍补,journalSchedule 先例)。
 */
import type { PluginEventBus } from "@kernel/plugin";
import { bootDocGenSession } from "./genSession";
import { enqueueDocGenTask } from "./queue";
import { createEntry, docgenSchedule, dimensionKeyOf, updateSchedule } from "./store";
import { getDocGenTemplate, isoWeekKey, periodRange } from "./templates";
import { todayISO } from "../analysis";

const TICK_MS = 15 * 60_000;

export interface ScheduleFireCheck {
  weekday: number;
  /** "HH:MM"。 */
  time: string;
  lastWeekKey?: string;
}

/** 周内 appointment 时刻(本周 weekday 的 time;周一为一周起点)。 */
export function appointmentOf(now: Date, cfg: ScheduleFireCheck): Date {
  const monday = new Date(now);
  const dow = now.getDay() || 7;
  monday.setDate(now.getDate() - (dow - 1));
  const [hh, mm] = cfg.time.split(":").map(Number);
  const at = new Date(monday);
  at.setDate(monday.getDate() + (cfg.weekday - 1));
  at.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  return at;
}

/** 是否该发(纯函数测试面):开关周内已过 appointment 且本周未发过。 */
export function scheduleFireDue(now: Date, cfg: ScheduleFireCheck): boolean {
  if (!Number.isInteger(cfg.weekday) || (cfg.weekday < 1 || cfg.weekday > 5)) return false;
  if (cfg.lastWeekKey === isoWeekKey(now)) return false;
  return now.getTime() >= appointmentOf(now, cfg).getTime();
}

/** 发一次排程生成(建条目+入队+落幂等闸);返回是否真的发了。 */
export async function fireScheduledNow(now: Date): Promise<boolean> {
  const cfg = docgenSchedule();
  const weekKey = isoWeekKey(now);
  if (cfg.lastWeekKey === weekKey) return false;
  const template = getDocGenTemplate(cfg.templateId);
  if (!template || template.analysisOnly) return false;
  const period = periodRange("本周", todayISO());
  const scope = { kind: "all" } as const;
  const entry = await createEntry({
    templateId: template.id,
    title: `${template.label} · ${period.label}`,
    scope,
    periodKey: period.key,
    periodLabel: period.label,
    periodFrom: period.from,
    periodTo: period.to,
    audience: template.defaultAudience,
    engine: cfg.engine,
    sources: template.defaultSources,
    scheduled: true,
  });
  enqueueDocGenTask("排程生成", entry.id, dimensionKeyOf(template.id, scope, period.key), cfg.engine);
  /* 幂等闸先落(会话失败不补跑,与 journal 定时珠语义一致)。 */
  await updateSchedule({ lastWeekKey: weekKey });
  return true;
}

/** activate 装配;ready = loadDocGen 完成门(配置未读回前不对表,journal B4 同教训)。 */
export function bootDocGenSchedule(events: PluginEventBus, ready: Promise<void>): () => void {
  let iv: ReturnType<typeof setInterval> | undefined;
  let armed = false;
  const tick = () => {
    const cfg = docgenSchedule();
    if (cfg.on && scheduleFireDue(new Date(), cfg)) void fireScheduledNow(new Date()).catch(() => undefined);
  };
  const arm = () => {
    if (armed) return;
    armed = true;
    tick(); /* boot 补跑由 tick 内 scheduleFireDue 覆盖(appointment 已过即发,幂等闸防重) */
    iv = setInterval(tick, TICK_MS);
  };
  void ready.then(arm);
  const offGen = bootDocGenSession(events);
  return () => {
    clearInterval(iv);
    offGen();
  };
}
