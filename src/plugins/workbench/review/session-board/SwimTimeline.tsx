/**
 * 泳道时间线 —— 左侧共享小时时轨(HH:00 · N 个会话)+ 三道垂直泳道(五态投影,
 * BOARD_LANES 口径)按小时分带对齐。
 * 卡片:时刻 + 引擎图标 + 标题 + 相对时间;悬停出 ✎ 重命名 / ↩ 恢复(已归档);
 * 已归档卡整卡置灰;「未查看」卡单击 = 查看(宿主回调,含自动归档规则)。
 * 列头可折叠(跨日保持,折叠列各时带留空);悬停卡反标节律段(onHoverHour)。
 * 重命名/查看的反馈 toast 经 onNotice 上抛(呈现归 BoardTab)。
 */
import { useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  PencilSimple,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { RenameInput } from "@kernel/RenameInput";
import { formatRelativeTime } from "@kernel/relativeTime";
import { sessionArchiveKey, unarchiveSession } from "@kernel/sessionArchive";
import { keepSession, sessionKeepKey } from "@kernel/sessionKeep";
import { setSessionTitle } from "@kernel/sessionTitles";
import { BOARD_LANES, engineColor, hourOf, laneOf, type BoardSession } from "./boardData";
const pad = (n: number) => String(n).padStart(2, "0");

export function SwimTimeline({
  sessions,
  hlHour,
  showWs,
  onOpen,
  onHoverHour,
  onNotice,
}: {
  sessions: BoardSession[];
  /** 节律条选中小时:高亮该时全部卡;null = 无。 */
  hlHour: number | null;
  /** 全部工作区视图:卡片 meta 显示归属工作区名。 */
  showWs: boolean;
  onOpen: (s: BoardSession) => void;
  /** 悬停卡反标节律段:null = 离开。 */
  onHoverHour: (h: number | null) => void;
  /** 轻反馈(重命名等)上抛,由看板根统一 toast。 */
  onNotice: (msg: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 折叠列(跨日保持:DayPanel 挂载期间 state 不清;关闭日视图重置)。 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const byStateHour = useMemo(() => {
    const map = new Map<string, BoardSession[]>();
    for (const s of sessions) {
      const k = `${laneOf(s.st)}:${hourOf(s.ts)}`;
      const arr = map.get(k);
      if (arr) arr.push(s);
      else map.set(k, [s]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.ts - b.ts);
    return map;
  }, [sessions]);
  const hourList = useMemo(
    () => [...new Set(sessions.map((s) => hourOf(s.ts)))].sort((a, b) => a - b),
    [sessions],
  );
  const stateCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sessions) c[laneOf(s.st)] = (c[laneOf(s.st)] ?? 0) + 1;
    return c;
  }, [sessions]);

  return (
    <div className="sb-tl" onMouseLeave={() => onHoverHour(null)}>
      <div className="sb-tl-head">
        <div className="sb-tl-rail-pad" aria-hidden />
        {BOARD_LANES.map(({ key, label }) => {
          const closed = collapsed.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`sb-lane-h sb-lh-${key}${closed ? " closed" : ""}`}
              title={t("点击折叠/展开本列(跨日保持)")}
              aria-expanded={!closed}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            >
              <span className="sb-lane-h-l1">
                {closed ? <CaretRight size="0.5625rem" aria-hidden /> : <CaretDown size="0.5625rem" aria-hidden />}
                <span className="sb-lane-h-name">{t(label)}</span>
                <span className="sb-lane-h-n">{stateCount[key] ?? 0}</span>
              </span>
            </button>
          );
        })}
      </div>
      {hourList.length === 0 && <div className="sb-tl-empty">{t("当日无会话")}</div>}
      {hourList.map((h) => {
        const rows = sessions.filter((s) => hourOf(s.ts) === h);
        return (
          <div key={h} className="sb-band" data-hour={h}>
            <div className="sb-band-rail">
              <span className="sb-band-h">{pad(h)}:00</span>
              <span className="sb-band-n">{t("{n} 个会话", { n: rows.length })}</span>
            </div>
            {BOARD_LANES.map(({ key }) => {
              if (collapsed.has(key)) return <div key={key} className="sb-lane-cell closed" aria-hidden />;
              const cards = byStateHour.get(`${key}:${h}`) ?? [];
              return (
                <div key={key} className="sb-lane-cell">
                  {cards.map((s) => {
                    const time = `${pad(new Date(s.ts).getHours())}:${pad(new Date(s.ts).getMinutes())}`;
                    const canRename = !!s.cliSessionId;
                    return (
                      <span key={s.key} className="sb-card-host">
                        {renaming === s.key && canRename ? (
                          <RenameInput
                            className="sb-rename"
                            target={{ current: s.title }}
                            onCommit={(v) => {
                              setRenaming(null);
                              if (v !== null && s.cliSessionId) {
                                setSessionTitle(s.profileId, s.cliSessionId, v);
                                onNotice(t("已重命名:{title}", { title: v }));
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={[
                              "sb-card",
                              laneOf(s.st) === "archived" ? "dim" : "",
                              hlHour === h ? "hl" : "",
                              s.live ? "live" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{ "--ec": engineColor(s.profileId) } as React.CSSProperties}
                            title={`${s.profile.name} · ${s.title}`}
                            onClick={() => onOpen(s)}
                            onMouseEnter={() => onHoverHour(h)}
                          >
                            <span className="sb-card-c1">
                              <span className="sb-card-time">{time}</span>
                              <span className="sb-card-eng" aria-hidden>
                                {s.profile.renderIcon?.("0.75rem")}
                              </span>
                              {s.st === "running" && <i className="sb-dot run pulse" aria-hidden />}
                              {s.unread && <i className="sb-dot unread" aria-hidden />}
                            </span>
                            <span className="sb-card-t">{s.title}</span>
                            <span className="sb-card-meta">
                              {showWs && s.wsName ? <span className="sb-card-ws">{s.wsName}</span> : null}
                              {s.disk ? formatRelativeTime(s.disk.modifiedAt) : t("运行时")}
                            </span>
                          </button>
                        )}
                        {renaming !== s.key && (
                          <span className="sb-card-acts">
                            {canRename && (
                              <button
                                type="button"
                                className="sb-act"
                                aria-label={t("重命名")}
                                title={t("重命名")}
                                onClick={() => setRenaming(s.key)}
                              >
                                <PencilSimple size="0.6875rem" aria-hidden />
                              </button>
                            )}
                            {s.st === "archived" && s.cliSessionId && (
                              <button
                                type="button"
                                className="sb-act"
                                aria-label={t("恢复(取消归档)")}
                                title={t("恢复(取消归档)")}
                                onClick={() => {
                                  /* 手动取消归档 = 显式保留意图:写 keep,卫生清扫跳过 */
                                  unarchiveSession(
                                    sessionArchiveKey(s.wsId, s.profileId, s.cliSessionId!),
                                  );
                                  keepSession(
                                    sessionKeepKey(s.wsId, s.profileId, s.cliSessionId!),
                                  );
                                }}
                              >
                                <ArrowCounterClockwise size="0.6875rem" aria-hidden />
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
