/**
 * 年视图 · 日格数据构建(无组件纯模块,守 react-doctor 复杂度铁则):
 * MiniMonth 的日循环/分位阈值/五态叠层类名全在这里算好,渲染面只剩 map。
 */
import { dayMetaOf, deriveDayStatus, heatOf, heatThresholds, type MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";
import { pad2 } from "./journalFiles";
import { holOf, isWorkdayOverride } from "./holidays";

export interface YearCell {
  key: string;
  cls: string;
  title: string;
}

/** 点阵类叠层(状态底色 + 周末底纹 + 便签内框,原型同款可共存)。
 *  热力档与月视图同源(heatOf + 当月 25/50/75 分位):同日跨视图不再不同色。 */
function cellCls(st: string, hasNote: boolean, heat: string, hol: boolean, we: boolean): string {
  return [
    hol ? "dj-yc-hol" : st === "t" ? "dj-yc-t" : st === "p" ? "dj-yc-p" : st === "f" ? "dj-yc-f" : st === "g" ? `dj-yc-${heat}` : "",
    we ? "dj-yc-we" : "",
    hasNote ? "dj-yc-note" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 当月日格数据 + 统计。月快照未就绪(L16):文章在否未知,t/g/p/热力皆假状态 ——
 *  除今日环外一律中性灰,快照到齐即自然换色,不再「待提取」黄跳变;
 *  失败(f)依据全局 meta,如实保留。 */
export function monthCells(
  y: number,
  m: number,
  snap: MonthSnapshot | undefined,
  sessions: Map<string, DaySessionRow[]>,
  today: string,
): { cells: YearCell[]; artDays: number; sessDays: number } {
  const days = new Date(y, m, 0).getDate();
  const prefix = `${y}-${pad2(m)}`;
  /* 当月活跃日分位阈值(与月视图 heatThresholds 同一函数): */
  const counts: number[] = [];
  for (let d = 1; d <= days; d++) {
    const rows = sessions.get(`${prefix}-${pad2(d)}`);
    if (rows?.length) counts.push(rows.length);
  }
  const ts = heatThresholds(counts);
  const cells: YearCell[] = [];
  let artDays = 0;
  let sessDays = 0;
  for (let d = 1; d <= days; d++) {
    const dd = pad2(d);
    const key = `${prefix}-${dd}`;
    const rows = sessions.get(key) ?? [];
    const article = snap?.articles[dd] ?? null;
    if (article) artDays++;
    if (rows.length) sessDays++;
    /* 调休上班日(off:false)不再画周末底纹 */
    const we = [0, 6].includes(new Date(y, m - 1, d).getDay()) && !isWorkdayOverride(y, m, d);
    const st = deriveDayStatus(article, key === today, rows.length, dayMetaOf(key));
    const effSt = snap ? st : key === today ? "t" : st === "f" ? "f" : "n";
    cells.push({
      key: dd,
      cls: cellCls(effSt, !!snap?.notes[dd], heatOf(rows.length, ts), !!holOf(y, m, d), we),
      title: `${m}/${d} · ${rows.length}`,
    });
  }
  return { cells, artDays, sessDays };
}
