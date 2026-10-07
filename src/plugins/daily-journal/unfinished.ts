/**
 * 「昨日未完」聚合口径(纯函数,W3 晨启动面消费)。
 *
 * 口径(docs/review/2026-10-06-032-workflow-logic-review.md W3 第 1 条):
 * - 会话两桶(归日筛均为调用方职责):活行按 startedAt 归昨日(rowDayKey 同源,
   跨夜挂起);盘行按 lastActive(结束时刻)归昨日。入聚合再共守:未归档 +
   今日零点后无活动(点续/续聊自动出列,与手动摘除互为兜底);盘行另限
 *   ended-new 窗(boardRows 同一 14 天常量,超窗视作早已看过)。
 * - 便签:未勾(checked !== true;昨日含更早,调用方决定喂哪些日子)。
 * 不引入「已查看」新写入口;不解析文章「未完事项」节(正文自带,上下文相邻)。
 */
import type { DaySessionRow } from "./daySessions";
/* 跨插件消费 session-board 声明的口径常量(app 树例外条款见
 * docs/architecture/02-code-architecture.md「依赖铁律」;mobile 树 import
 * cli-* 适配器同款先例):14 天未查看阈与 board 注意力面单一真相源。 */
import { UNSEEN_WINDOW_MS } from "../session-board/boardRows";

export interface UnfinishedSessionInput {
  profileId: string;
  title: string;
  startedAt: number;
  /** 活 = host 活表最新活动;盘 = 磁盘 modifiedAt。 */
  lastActive: number;
  live: boolean;
  /** 归档标记存在(session-board 设置层)= 已收尾,永不入聚合。 */
  archived: boolean;
}

export interface UnfinishedNoteInput {
  key: string;
  text: string;
  updatedAt: number;
  checked?: boolean;
}

export interface UnfinishedSession {
  /** live=跨夜挂起(点续=聚焦终端);非 live=未查看(点查看=openDiskSession 续聊)。 */
  kind: "idle" | "unseen";
  profileId: string;
  title: string;
  startedAt: number;
  lastActive: number;
}

export interface UnfinishedNote {
  key: string;
  text: string;
  updatedAt: number;
}

export function collectUnfinished(
  sessions: readonly UnfinishedSessionInput[],
  notes: readonly UnfinishedNoteInput[],
  clock: { todayStart: number; now: number },
): { sessions: UnfinishedSession[]; notes: UnfinishedNote[] } {
  const out: UnfinishedSession[] = [];
  for (const s of sessions) {
    if (s.archived) continue;
    /* 今日零点后有活动 = 已经动过,不是「未完」(一轮设计漏此条会永久挂聚合)。 */
    if (s.lastActive >= clock.todayStart) continue;
    if (s.live) {
      out.push({
        kind: "idle",
        profileId: s.profileId,
        title: s.title,
        startedAt: s.startedAt,
        lastActive: s.lastActive,
      });
    } else if (clock.now - s.lastActive < UNSEEN_WINDOW_MS) {
      out.push({
        kind: "unseen",
        profileId: s.profileId,
        title: s.title,
        startedAt: s.startedAt,
        lastActive: s.lastActive,
      });
    }
  }
  const outNotes = notes
    .filter((n) => n.checked !== true)
    .map((n) => ({ key: n.key, text: n.text, updatedAt: n.updatedAt }));
  return { sessions: out, notes: outNotes };
}

/** 聚合行装配(纯函数):两桶 —— 昨日桶活行(跨夜挂起,开始日归桶)+
 *  全表盘行落「昨日最后写入窗」(昨日结束的未查看会话,行桶在更早日开始,
 *  只取昨日桶会整类漏聚)。窗边界半开 [dayStart, nextDayStart)。 */
export function unfinishedPanelRows(
  days: Map<string, DaySessionRow[]>,
  yesterdayKeyStr: string,
  dayStart: number,
  nextDayStart: number,
): DaySessionRow[] {
  const live = (days.get(yesterdayKeyStr) ?? []).filter((r) => r.live);
  const disk: DaySessionRow[] = [];
  for (const rows of days.values()) {
    for (const r of rows) {
      if (!r.live && r.modifiedAt >= dayStart && r.modifiedAt < nextDayStart) disk.push(r);
    }
  }
  return [...live, ...disk];
}
