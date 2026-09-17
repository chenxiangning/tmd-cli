/**
 * 会话看板数据装配 —— 类型/常量/日期格式化 + useBoardSessions(扫描 hook)。
 * 行装配纯函数(mergeDisk/mergeLive)在 boardRows.ts(300 行铁则拆分)。
 * 数据源全部复用既有层(spec: docs/superpowers/specs/2026-09-16-session-board-design.md):
 * 磁盘 = profile.listSessions;活会话 = 内核注册表(绑定磁盘身份去重);已归档 = sessionArchive;
 * 运行中/空闲 = host.isTurnActive;未查看 = 未归档 且 14 天内有活动(年龄启发,首跑免疫)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { getSettingsState, useSettingsState } from "@kernel/settings";
import type { Workspace } from "@kernel/workspace";
import { mergeDisk, mergeLive, type ScanEntry } from "./boardRows";

export type BoardState = "running" | "idle" | "ended-new" | "ended-seen" | "archived";

export const BOARD_STATES: readonly { key: BoardState; label: string }[] = [
  { key: "running", label: "运行中" },
  { key: "idle", label: "待运行" },
  { key: "ended-new", label: "结束-未查看" },
  { key: "ended-seen", label: "结束-已查看" },
  { key: "archived", label: "已归档" },
];

export interface BoardSession {
  /** 去重键:`${wsId}:${profileId}:${cliSessionId}`。 */
  key: string;
  profile: CliProfile;
  profileId: string;
  /** CLI 磁盘会话 id;未落盘的活会话缺省(不可改名/归档)。 */
  cliSessionId?: string;
  /** 归属工作区(归档/删除 key 前缀);孤儿活会话为 ""。 */
  wsId: string;
  /** 归属工作区显示名(全部工作区视图卡片标识用)。 */
  wsName: string;
  /** 归属工作区根(openDiskSession 用)。 */
  wsRoot: string;
  title: string;
  /** 会话时刻 = 创建时刻(createdAt;缺省回退 modifiedAt/spawn 时刻)。日历落位定死:
   *  resume 老会话只刷 mtime/updated_at,createdAt 不动 —— 卡片不跳日。 */
  ts: number;
  /** 最近活跃时刻(modifiedAt;活会话=现在)。落位双日:活跃日 ≠ 创建日时也出现,
   *  满足「创建定死不跳日」与「今天在用的会话今天可见」两个诉求(用户实测补缺)。 */
  activeTs: number;
  st: BoardState;
  live: boolean;
  /** 活会话的宿主 id(点击激活用);磁盘行为空。 */
  hostId?: string;
  /** 磁盘行本体(打开/改名/归档 key 用);活会话缺省。 */
  disk?: CliDiskSession;
  /** 活会话未读(轮次结束未查看,侧栏「空闲-未查看」同语义)。 */
  unread?: boolean;
}

/** 本地日 key(非 UTC):月历格 / 日视图分日用。 */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 本地日零点(非 UTC):未来格判定等按日边界场景用。 */
export function dayStartOf(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
export function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

/* Intl 构造有成本:按语言缓存格式器(语言设置低频变化,缓存键即语言)。 */
const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function fmtFor(language: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = language + JSON.stringify(opts);
  let f = FMT_CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", opts);
    FMT_CACHE.set(key, f);
  }
  return f;
}
/** 本地化月份标题(如 2026 年 9 月 / September 2026),语言随设置。 */
export function monthTitle(y: number, m: number): string {
  const { language } = getSettingsState().settings;
  if (language === "zh") return `${y} 年 ${m + 1} 月`;
  return fmtFor(language, { year: "numeric", month: "long" }).format(new Date(y, m, 1));
}

/** 本地化日标题(如 9 月 16 日 周三),语言随设置。 */
export function dayTitle(ts: number): string {
  const { language } = getSettingsState().settings;
  if (language === "zh") {
    const d = new Date(ts);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${["日", "一", "二", "三", "四", "五", "六"][d.getDay()]}`;
  }
  return fmtFor(language, { month: "short", day: "numeric", weekday: "short" }).format(new Date(ts));
}

/** 本地化周首字母行(日一二三四五六 / Sun..Sat)。 */
export function weekdayLabels(): string[] {
  const { language } = getSettingsState().settings;
  if (language === "zh") return ["日", "一", "二", "三", "四", "五", "六"];
  const fmt = fmtFor(language, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
}

/** 看板会话集(null = 扫描中)。活会话每次渲染现并(useHost 触发重渲染)。 */
export function useBoardSessions(
  /** 目标工作区集(单选传 1 个,全部传全部;空数组 = 无数据)。 */
  workspaces: Workspace[],
  /** 全部工作区视图(孤儿活会话也收)。 */
  allMode: boolean,
  refreshTick: number,
): BoardSession[] | null {
  useHost();
  const { settings } = useSettingsState();
  const [scan, setScan] = useState<ScanEntry[] | null>(null);

  /* 活会话表变化(开新会话/PTY 退出,含一走一开净数不变)触发重扫:会话结束后
   * 磁盘文件晚于快照落盘,不联动则该会话从看板蒸发直到手点「重新扫描」。 */
  const liveKey = host
    .getSessions()
    .map((m) => m.id)
    .join(",");
  /* 目标工作区集身份:逐个 id 排序拼接(全部模式下列表顺序不敏感)。 */
  const wsKey = workspaces
    .map((w) => w.id)
    .sort()
    .join(",");
  const scanForKey = useRef<string | null>(null);
  useEffect(() => {
    if (workspaces.length === 0) {
      setScan([]);
      return;
    }
    let alive = true;
    /* 仅目标集切换才清空(扫描期显「正在扫描」);联动/手动重扫保留旧行,
       新结果到达前不闪空(N≈2000 量级下可见闪烁,评审 P2)。 */
    if (scanForKey.current !== wsKey) {
      scanForKey.current = wsKey;
      setScan(null);
    }
    (async () => {
      const profiles = host.getCliProfiles().filter((p) => p.listSessions);
      const entries: ScanEntry[] = [];
      await Promise.all(
        workspaces.flatMap((ws) =>
          profiles.map((p) =>
            p
              .listSessions!(ws.root)
              .catch(() => [] as CliDiskSession[])
              .then((list) => {
                for (const disk of list) entries.push({ ws, profile: p, disk });
              }),
          ),
        ),
      );
      if (alive) setScan(entries);
    })();
    return () => {
      alive = false;
    };
    // workspaces 由 wsKey 表征(id 集),列表对象引用每次渲染可能新,不进 deps。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsKey, refreshTick, liveKey]);
  const diskRows = useMemo(
    () => (scan ? mergeDisk(scan, settings.sessionTitles, settings.sessionArchive) : []),
    // 归档/删除意图参与五态推导,必须进 deps(评审 P2:恢复/删除后看板要即变)。
    [scan, settings.sessionTitles, settings.sessionArchive, settings.sessionDeleted],
  );
  if (!scan) return null;
  /* 活会话绑定的磁盘身份 → 磁盘行去重(同一会话全局一次,活形态优先)。 */
  const liveRows = mergeLive(workspaces, allMode, settings.sessionTitles, scan);
  const liveKeys = new Set(
    liveRows.filter((r) => r.cliSessionId && r.wsId).map((r) => `${r.wsId}:${r.profileId}:${r.cliSessionId}`),
  );
  return [...liveRows, ...diskRows.filter((r) => !liveKeys.has(r.key))];
}

/** 引擎色:profile id 哈希 hue,深浅主题同亮度带。 */
export function engineColor(profileId: string): string {
  let h = 0;
  for (let i = 0; i < profileId.length; i++) h = (h * 31 + profileId.charCodeAt(i)) % 360;
  return `hsl(${h} 52% 48%)`;
}
