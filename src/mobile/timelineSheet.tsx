/**
 * 时间线 sheet —— 本会话用户消息纵向流(最新在顶,spec 2026-10-05-mobile-session-timeline;
 * 2026-10-05 二轮改全程):分段渐进拉全量(timelineData.loadTimelineAll),条目带
 * 字节 offset,点击任意条 = 关 sheet + 历史定位视图(offset 前后文快照,重复文本
 * 各自精确绑定)。打开拉一次 + 失败重试(保留已到的 partial),不轮询(回顾工具
 * 非实时,外网省流量)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { loadTimelineAll, type TimelineEntry } from "./timelineData";
import { SheetBase } from "./SheetBase";

type TlState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "nofile" }
  | { kind: "waitbind" }
  | {
      kind: "done";
      path: string;
      entries: TimelineEntry[];
      capped: boolean;
      loaded: number;
      total: number;
      scanning: boolean;
    };

/** 列表条目:序号(1=最旧)+ 原文 3 行 clamp;全程条目皆可点。 */
function TimelineRow(props: { seq: number; text: string; onJump: () => void }) {
  return (
    <button type="button" className="tl-item" onClick={props.onJump}>
      <span className="tl-seq">{props.seq}</span>
      <span className="tl-text">{props.text}</span>
    </button>
  );
}

export function TimelineSheet(props: {
  profileId: string;
  cwd: string;
  /** CLI 会话身份(注册表绑定镜像);缺位 = 等待绑定,不回落猜文件。 */
  cliSessionId: string | undefined;
  onClose: () => void;
  onJump: (path: string, entry: TimelineEntry) => void;
}) {
  const [state, setState] = useState<TlState>({ kind: "loading" });
  /* 渐进节流:onPartial 每段一发频已低(每段一次 RPC),直接 setState 即可;
     ref 防卸载后 setState(unmount 竞态)。 */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /* 版本守卫:会话切换重 pull 时,旧在途扫描的 partial/then/catch 全作废
   *   (2026-10-06 收口:旧实现只有 unmount 守卫,旧会话条目可串显新会话)。 */
  const pullSeq = useRef(0);
  const pull = useCallback(() => {
    if (!props.cliSessionId) {
      setState({ kind: "waitbind" });
      return;
    }
    const seq = ++pullSeq.current;
    setState({ kind: "loading" });
    loadTimelineAll(props.profileId, props.cwd, props.cliSessionId, (entries, p) => {
      if (!alive.current || pullSeq.current !== seq) return;
      setState((cur) =>
        cur.kind === "loading"
          ? { kind: "done", path: p.path, entries, capped: false, loaded: p.loaded, total: p.total, scanning: true }
          : cur.kind === "done"
            ? { ...cur, entries, loaded: p.loaded }
            : cur,
      );
    })
      .then((r) => {
        if (!alive.current || pullSeq.current !== seq) return;
        /* 渐进回调先于 then 落地;done 收口合并 path/capped/停扫。 */
        setState((cur) =>
          r === null
            ? { kind: "nofile" }
            : {
                kind: "done",
                path: r.path,
                entries: r.entries,
                capped: r.capped,
                loaded: r.entries.length ? (cur.kind === "done" ? cur.loaded : 0) : 0,
                total: cur.kind === "done" ? cur.total : 0,
                scanning: false,
              },
        );
      })
      .catch((e: unknown) => {
        if (!alive.current || pullSeq.current !== seq) return;
        /* partial 已在手时保留条目,只标错误可重试(全程扫描中途断网不白拉)。 */
        setState((cur) =>
          cur.kind === "done"
            ? { ...cur, scanning: false }
            : { kind: "error", message: e instanceof Error ? e.message : String(e) },
        );
      });
  }, [props.profileId, props.cwd, props.cliSessionId]);
  useEffect(pull, [pull]);

  return (
    <SheetBase label={t("时间线")} title={t("时间线")} onClose={props.onClose}>
      <div className="tl-list">
        {state.kind === "loading" && t("加载中…")}
        {state.kind === "waitbind" && t("等待会话身份绑定…")}
        {state.kind === "error" && (
          <>
            {t("读取失败")} <span className="tl-err-detail">{state.message.slice(0, 120)}</span>{" "}
            <button type="button" className="lnk-btn" onClick={pull}>{t("重试")}</button>
          </>
        )}
        {state.kind === "nofile" && (
          <>
            {t("尚未找到会话记录文件")} <button type="button" className="lnk-btn" onClick={pull}>{t("重试")}</button>
          </>
        )}
        {state.kind === "done" && state.entries.length === 0 && !state.scanning && t("还没有用户消息")}
        {state.kind === "done" && state.entries.length > 0 && (() => {
          const rows = [...state.entries].reverse(); /* 最新在顶 */
          const pct = state.total > 0 ? Math.round((state.loaded / state.total) * 100) : 100;
          return (
            <>
              {state.scanning && (
                <div className="tl-note">{t("正在载入更早消息 {pct}%", { pct })}</div>
              )}
              {state.capped && (
                <div className="tl-note">{t("会话超大,已显示最近一段内的 {n} 条", { n: state.entries.length })}</div>
              )}
              {rows.map((m, i) => (
                <TimelineRow
                  key={`${state.entries.length - i}:${m.id}`}
                  seq={state.entries.length - i}
                  text={m.text}
                  onJump={() => props.onJump(state.path, m)}
                />
              ))}
            </>
          );
        })()}
      </div>
    </SheetBase>
  );
}
