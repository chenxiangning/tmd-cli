/**
 * 看板聚焦日面板 —— 日头(日期 + 三道泳道计数 + 关闭)+ 24 小时节律条 + 泳道时间线。
 * 节律条:每小时一段,竖条高 = 该时会话数,色 = 该时主引擎;点段滚到对应时带。
 */
import { useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { dayTitle, engineColor, hourOf, laneOf, type BoardSession } from "./boardData";
import { SwimTimeline } from "./SwimTimeline";

const RHYTHM_MAX_H = 22;

export function DayPanel({
  dayKey,
  sessions,
  showWs,
  onOpen,
  onClose,
  onNotice,
}: {
  dayKey: string;
  sessions: BoardSession[];
  /** 全部工作区视图:卡片 meta 显示归属工作区名。 */
  showWs: boolean;
  onOpen: (s: BoardSession) => void;
  onClose: () => void;
  /** 轻反馈上抛(重命名等),由看板根统一 toast。 */
  onNotice: (msg: string) => void;
}) {
  const [hlHour, setHlHour] = useState<number | null>(null);
  /* 悬停卡反标节律段(与选中高亮共用 .hl 视觉,离开即清)。 */
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const p = dayKey.split("-").map(Number);
  const date = new Date(p[0], p[1], p[2]);
  const hours = useMemo(() => {
    const map = new Map<number, BoardSession[]>();
    for (const s of sessions) {
      const h = hourOf(s.ts);
      const arr = map.get(h);
      if (arr) arr.push(s);
      else map.set(h, [s]);
    }
    return map;
  }, [sessions]);
  const maxHour = Math.max(0, ...[...hours.values()].map((a) => a.length));
  const counts = useMemo(() => {
    const c: Record<string, number> = { running: 0, "ended-new": 0, archived: 0 };
    for (const s of sessions) c[laneOf(s.st)]++;
    return c;
  }, [sessions]);

  return (
    <div className="sb-day">
      <div className="sb-day-head">
        <span className="sb-day-date">{dayTitle(date.getTime())}</span>
        <span className="sb-day-meta">
          {t("{n} 个会话", { n: sessions.length })}
          <i className="sb-dot run" aria-hidden />{counts.running}
          <i className="sb-dot en" aria-hidden />{counts["ended-new"]}
          <i className="sb-dot ar" aria-hidden />{counts.archived}
        </span>
        <span className="sb-day-rule" title={t("查看未查看会话后自动归档;归档可逆,已归档卡悬停可恢复")}>
          {t("已查看 → 默认自动进入已归档")}
        </span>
        <span className="sb-kb" aria-hidden>← → {t("逐日")} · Esc {t("收起")}</span>
        <button type="button" className="sb-btn" aria-label={t("收起日视图")} onClick={onClose}>
          <X size="0.875rem" aria-hidden />
        </button>
      </div>

      <div className="sb-rhythm" role="listbox" aria-label={t("小时分布")}>
        {Array.from({ length: 24 }, (_, h) => {
          const rows = hours.get(h) ?? [];
          const dom = new Map<string, number>();
          for (const s of rows) dom.set(s.profileId, (dom.get(s.profileId) ?? 0) + 1);
          const main = [...dom.entries()].sort((a, b) => b[1] - a[1])[0];
          return (
            <button
              key={h}
              type="button"
              className={`sb-seg${rows.length ? " has" : ""}${hlHour === h || hoverHour === h ? " hl" : ""}`}
              title={`${h}:00 · ${t("{n} 个会话", { n: rows.length })}`}
              onClick={() => {
                setHlHour(h === hlHour ? null : h);
                /* 点段滚到对应时带(.sb-tl 为滚动容器,offsetTop 以其为参照)。 */
                requestAnimationFrame(() => {
                  const tl = document.querySelector(".sb-tl");
                  const band = tl?.querySelector<HTMLElement>(`[data-hour="${h}"]`);
                  if (tl && band) tl.scrollTo({ top: Math.max(0, band.offsetTop - 6), behavior: "smooth" });
                });
              }}
            >
              {rows.length > 0 && (
                <i
                  style={{
                    height: `${Math.max(4, Math.round((rows.length / maxHour) * RHYTHM_MAX_H))}px`,
                    background: main ? engineColor(main[0]) : undefined,
                  }}
                  aria-hidden
                />
              )}
              <span className="sb-seg-lbl">{h % 3 === 0 ? h : ""}</span>
            </button>
          );
        })}
      </div>

      <SwimTimeline
        sessions={sessions}
        hlHour={hlHour}
        showWs={showWs}
        onOpen={onOpen}
        onHoverHour={setHoverHour}
        onNotice={onNotice}
      />
    </div>
  );
}
