/**
 * tokens 用量 dashboard —— 首页页脚之下整幅区(用户红框位)。
 * 左列 = 按引擎用量行(QUOTA 行语言:名/占比条/量/占比),右列 = 近 7 日
 * 趋势双段柱(in 满高 + out 贴底 35%)。数据来自 tokens.ts 的本地 JSONL
 * usage 聚合,纯本地零网络。空态/部分数据语义见 spec 2026-09-11。
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import type { TokenAgg } from "./tokens";
import { collectTokenUsage } from "./tokens";
import "./tokens.css";

/** token 数展示缩略:1.4M / 320k / 780。 */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/* 模块级缓存(跨挂载存活):用量聚合 = 本地 JSONL 全量扫描,welcome 反复重挂
   不该每次从空态等扫盘 —— 缓存先上屏,后台重扫落定覆盖(重试按钮照常强制重拉)。 */
let aggCache: TokenAgg | null = null;

/** 趋势柱 lab:今日显「今日」,其余 M/D。 */
function dayLab(dayKey: string, today: boolean): string {
  if (today) return t("今日");
  const [, m, d] = dayKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function TokenDashboard() {
  /* 订阅快照 = profile 集指纹:仅插件拔插时重渲染;宿主其余通知(切换会话/
     输出/状态)与本页无关 —— welcome 常驻挂载后不为它们付整页渲染。 */
  useSyncExternalStore(
    host.subscribe,
    () => host.getCliProfiles().map((p) => p.id).join("|"),
  );
  const { list: workspaces } = useWorkspaces();
  const [agg, setAgg] = useState<TokenAgg | null>(aggCache);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  /* 挂载即拉一次(缓存命中也后台重扫,保持新鲜);重试按钮 ++reloadTick 重拉。 */
  useEffect(() => {
    if (workspaces.length === 0) return;
    let alive = true;
    setFailed(false);
    collectTokenUsage(host.getCliProfiles(), workspaces)
      .then((r) => {
        aggCache = r?.agg ?? aggCache;
        if (alive) setAgg(r?.agg ?? null);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [workspaces, reloadTick]);

  if (failed) {
    return (
      <div className="tokens">
        <div className="tokens-empty">
          {t("用量数据加载失败")}{" "}
          <button type="button" onClick={() => setReloadTick((n) => n + 1)}>
            {t("重试")}
          </button>
        </div>
      </div>
    );
  }

  if (!agg) {
    return (
      <div className="tokens">
        <div className="tokens-empty">…</div>
      </div>
    );
  }

  /* 预计算过滤(非 filter().map() 链):零消耗引擎整行隐藏。 */
  const engineRows = agg.byEngine.filter((e) => e.hasUsage);
  const grandTotal = agg.daily.reduce((s, d) => s + d.totalIn + d.totalOut, 0);
  const lastDay = agg.daily[agg.daily.length - 1];
  const weekPeak = Math.max(...agg.daily.map((d) => d.totalIn + d.totalOut), 1);
  return (
    <div className="tokens">
      <div className="tokens-head">
        <h3>tokens — {t("用量")}</h3>
        <div className="tokens-stats">
          <span>
            <span className="k">{t("今日")}</span>{" "}
            <span className="v">{fmtTok(lastDay.totalIn + lastDay.totalOut)} tok</span>
          </span>
          <span>
            <span className="k">{t("7 日")}</span> <span className="v">{fmtTok(grandTotal)} tok</span>
          </span>
          <span>
            <span className="k">{t("消耗会话")}</span> <span className="v">{agg.sessions}</span>
          </span>
          {agg.totals.cost > 0 && (
            <span>
              <span className="k">{t("pi 系费用")}</span>{" "}
              <span className="v hot">${agg.totals.cost.toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>
      {grandTotal === 0 ? (
        <div className="tokens-empty">{t("近 7 日无消费")}</div>
      ) : (
        <div className="tokens-grid">
          <div className="col">
            {engineRows.map((e) => {
              const total = e.totalIn + e.totalOut;
              return (
                <div key={e.profileId} className="trow">
                  <span className="en">
                    <span className="nm">{e.profileId}</span>
                  </span>
                  <span
                    className="bar"
                    style={{
                      "--w": `${grandTotal > 0 ? (total / grandTotal) * 100 : 0}%`,
                      "--ow": `${total > 0 ? (e.totalOut / total) * 100 : 0}%`,
                    } as React.CSSProperties}
                  >
                    <i className="strip in" />
                    <i className="strip out" />
                    <span className="bv">{fmtTok(total)}</span>
                  </span>
                  <span className="pct">{grandTotal > 0 ? `${Math.round((total / grandTotal) * 100)}%` : "—"}</span>
                </div>
              );
            })}
          </div>
          <div className="col">
            <div className="trend">
              {agg.daily.map((d, i) => {
                const total = d.totalIn + d.totalOut;
                const today = i === agg.daily.length - 1;
                return (
                  <div
                    key={d.dayKey}
                    className={`day${today ? " today" : ""}`}
                    title={`${dayLab(d.dayKey, today)} · ${fmtTok(total)} tok`}
                  >
                    <div className="stack">
                      {total > 0 && (
                        <>
                          <i
                            className="out"
                            style={{ "--w": `${(d.totalOut / total) * 100}%` } as React.CSSProperties}
                          />
                          <i className="in" style={{ height: `${(total / weekPeak) * 100}%` }} />
                        </>
                      )}
                    </div>
                    <div className="lab">{dayLab(d.dayKey, today)}</div>
                  </div>
                );
              })}
            </div>
            <div className="trend-foot">
              <span>
                <span className="sw" style={{ background: "var(--tmd-ok)" }} />
                {t("输出")}
              </span>
              <span>
                <span className="sw" style={{ background: "var(--tmd-ok-dim)" }} />
                {t("输入+缓存")}
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="note">{t("数据源 = 本地会话记录,仅统计近 7 日")}</div>
    </div>
  );
}
