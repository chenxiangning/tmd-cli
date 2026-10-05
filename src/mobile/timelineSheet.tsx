/**
 * 时间线 sheet —— 本会话用户消息纵向流(最新在顶,spec 2026-10-05-mobile-session-timeline)。
 * 数据层在 ./timelineData(定位 → 2MB 尾读 → 行解析);点击条目 = 关 sheet +
 * 对话流 .tr-user 文本匹配 scrollIntoView(重复文本取最新位置,由「最后一个匹配」
 * 天然给出);不在 turns 尾窗(40 轮)内置灰可读。打开拉一次 + 失败重试,
 * 不轮询(回顾工具非实时,外网省流量)。
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import type { CliUserMessage } from "@kernel/cli";
import { clipText, type TranscriptTurn } from "@kernel/transcript";
import { loadTimeline, reachableTexts } from "./timelineData";
import { SheetBase } from "./SheetBase";

type TlState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "nofile" }
  | { kind: "waitbind" }
  | { kind: "done"; messages: CliUserMessage[]; truncated: boolean };

/** 列表条目:序号(1=最旧)+ 原文 3 行 clamp;窗外置灰。 */
function TimelineRow(props: { seq: number; text: string; ok: boolean; onJump: () => void }) {
  return (
    <button
      type="button"
      className={"tl-item" + (props.ok ? "" : " dim")}
      disabled={!props.ok}
      onClick={props.onJump}
    >
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
  turns: TranscriptTurn[] | null;
  onClose: () => void;
  onJump: (text: string) => void;
}) {
  const [state, setState] = useState<TlState>({ kind: "loading" });
  const pull = useCallback(() => {
    if (!props.cliSessionId) {
      setState({ kind: "waitbind" });
      return;
    }
    setState({ kind: "loading" });
    loadTimeline(props.profileId, props.cwd, props.cliSessionId)
      .then((r) => setState(r === null ? { kind: "nofile" } : { kind: "done", messages: r.messages, truncated: r.truncated }))
      .catch((e: unknown) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
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
        {state.kind === "done" && state.messages.length === 0 && t("还没有用户消息")}
        {state.kind === "done" && state.messages.length > 0 && (() => {
          const reach = reachableTexts(props.turns);
          const rows = [...state.messages].reverse(); /* 最新在顶 */
          return (
            <>
              {state.truncated && (
                <div className="tl-note">{t("会话较长,仅显示最近 {n} 条", { n: state.messages.length })}</div>
              )}
              {rows.map((m, i) => (
                <TimelineRow
                  key={`${state.messages.length - i}:${m.id}`}
                  seq={state.messages.length - i}
                  text={m.text}
                  ok={reach.has(clipText(m.text))}
                  onJump={() => props.onJump(m.text)}
                />
              ))}
            </>
          );
        })()}
      </div>
    </SheetBase>
  );
}
