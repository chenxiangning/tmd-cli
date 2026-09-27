/**
 * 看板「等待确认」置顶分区(spec 2026-09-27)—— 跨日注意力位。
 * 成员 = live 行 × host.isWaitingConfirm(内核真相位,零新增检测);
 * 时长 = waitingSince(askDetected 边沿记时;边沿缺失显示「等待中」不假起走)。
 * 静态分区:仅非空时出现,不重排月历/日格任何既有内容;点行开 tab 不收板
 * (2026-09-16 用户指令,dayOpen 活会话分支同语义)。
 */
import { useEffect, useState } from "react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { engineColor, type BoardSession } from "./boardData";
import { waitingSinceOf } from "./waitingSince";

/** 等待时长文案;与 approval-inbox formatWait 同串同译(两插件词典同键一致由同串保证)。 */
function formatWait(since: number | null): string {
  if (since === null) return t("等待中");
  const elapsed = Math.max(0, Date.now() - since);
  if (elapsed < 60_000) return t("等待 {n} 秒", { n: Math.floor(elapsed / 1000) });
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return t("等待 {n} 分钟", { n: minutes });
  return t("等待 {n} 小时", { n: Math.floor(minutes / 60) });
}

/** 纯呈现面(测试断言;等待集经 props 注入)。空集返回 null(分区仅非空时出现)。 */
export function WaitingStripView({
  rows,
  waitingIds,
  onOpen,
}: {
  rows: readonly BoardSession[];
  waitingIds: ReadonlySet<string>;
  onOpen: (s: BoardSession) => void;
}) {
  const waiting = rows.flatMap((s) =>
    s.live && s.hostId != null && waitingIds.has(s.hostId) ? [{ s, id: s.hostId }] : [],
  );
  if (waiting.length === 0) return null;
  return (
    <section className="sb-wait" aria-label={t("等待确认")}>
      <span className="sb-wait-head">
        {t("等待确认")} · {t("{n} 个会话", { n: waiting.length })}
      </span>
      <div className="sb-wait-rows">
        {waiting.map(({ s, id }) => (
          <button
            key={id}
            type="button"
            className="sb-card"
            style={{ "--ec": engineColor(s.profileId) } as React.CSSProperties}
            onClick={() => onOpen(s)}
          >
            <span className="sb-card-c1">
              <span className="sb-card-t">{s.title}</span>
              <span className="sb-wait-dur">{formatWait(waitingSinceOf(id))}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 挂载面:现查内核等待位 + 30s 步进重算时长(挂载即有等待行,常驻 interval)。 */
export function WaitingStrip({
  rows,
  onOpen,
}: {
  rows: readonly BoardSession[];
  onOpen: (s: BoardSession) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const waitingIds = new Set(
    host
      .getSessions()
      .filter((s) => host.isWaitingConfirm(s.id))
      .map((s) => s.id),
  );
  return <WaitingStripView rows={rows} waitingIds={waitingIds} onOpen={onOpen} />;
}
