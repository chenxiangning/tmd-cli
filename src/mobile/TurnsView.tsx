/**
 * transcript 对话/操作分层渲染 —— SessionScreen 与 HistoryScreen 共用;
 * turns 来自 append-only 会话日志,解析后不重排不插入,下标即稳定身份
 * (key 用下标是语义正解,非图省事)。助手长文默认 clamp,点击展开。
 * 视觉重皮(spec 2026-09-25-mobile-session-render,对标 codemoss 消息时间线):
 * 连续 tool turn 在渲染层归组折叠为一条「工具调用 {n} 次」芯片,数据与顺序不动。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import type { TranscriptTurn } from "@kernel/transcript";
import { groupTurns } from "./shared";

/** 助手消息超过该行数默认折叠(窄屏一屏被一条长文吃满)。 */
const CLAMP_LINES = 8;

function AssistantMsg(props: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = props.text.split("\n");
  const long = lines.length > CLAMP_LINES;
  const body = long && !open ? lines.slice(0, CLAMP_LINES).join("\n") : props.text;
  if (!long) return <div className="tr-asst">{body}</div>;
  return (
    <button
      type="button"
      className="tr-asst tr-asst-btn"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {body}
      <span className="tr-more">
        {open ? ` ▴ ${t("收起")}` : ` ▾ ${t("展开全文")}`}
      </span>
    </button>
  );
}

/** 折叠工具运行:默认一条芯片,点开逐条单行摘要;再点收起。 */
function ToolRun(props: { items: TranscriptTurn[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tr-run-open">
      <button
        type="button"
        className="tr-run"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} ⚙ {t("工具调用 {n} 次", { n: props.items.length })}
      </button>
      {open &&
        props.items.map((tn, k) => (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- 组内瞬态展开列表,append-only
          <div className="tr-tool" key={k}>
            ⚙ {tn.tool}
            {tn.text ? ` ${tn.text}` : ""}
          </div>
        ))}
    </div>
  );
}

export function TurnsView(props: { turns: TranscriptTurn[] }) {
  return (
    <div className="tr">
      {groupTurns(props.turns).map((seg) => {
        if (seg.kind === "run") return <ToolRun items={seg.items} key={seg.index} />;
        if (seg.kind === "user") {
          return (
            <div className="tr-user" key={seg.index}>
              {seg.turn.text}
            </div>
          );
        }
        return <AssistantMsg text={seg.turn.text} key={seg.index} />;
      })}
    </div>
  );
}

/** ask 审批卡:活流尾窗命中等待标记时出现;允许/拒绝 = 与幕布按键同一 session_write。 */
export function AskCard(props: { q: string | null; onAnswer: (data: string) => void }) {
  return (
    <div className="ask">
      <div className="ask-head">⚠ {t("审批请求")}</div>
      <div className="ask-q">
        {props.q ?? t("CLI 正在等待确认;「允许」发送 Enter,「拒绝」发送 Esc")}
      </div>
      <div className="ask-opts">
        <button type="button" className="opt yes" onClick={() => props.onAnswer("\r")}>
          {t("允许")}
        </button>
        <button type="button" className="opt no" onClick={() => props.onAnswer("\x1b")}>
          {t("拒绝")}
        </button>
      </div>
    </div>
  );
}

/** 「加载更早输出」柄:hasMore=false 且已拉过 = 已到开头。 */
function EarlierButton(props: { hasMore?: boolean; loading?: boolean; onLoad?: () => void }) {
  if (!props.hasMore && !props.onLoad) return null;
  const label = props.loading ? t("加载中…") : props.hasMore ? t("加载更早输出") : t("已到开头");
  return (
    <button type="button" className="tr-live-tag" disabled={props.loading || !props.hasMore} onClick={props.onLoad}>
      {label}
    </button>
  );
}

/** 实况块内容:有对话时默认折叠(窄屏终端流不可读),点开看;无对话 = 全屏实况。 */
export function LiveBlock(props: {
  turns: TranscriptTurn[] | null;
  live: string;
  liveShown: boolean;
  onExpandLive: () => void;
  onCollapseLive: () => void;
  /** PTY 日志回看(桌面分页协议,start_offset/has_more;剥 ANSI 线性文本)。 */
  earlier?: string;
  hasMore?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
}) {
  const { turns, live, liveShown } = props;
  return (
    <>
      {turns && !liveShown && (
        <button className="tr-live-toggle" onClick={props.onExpandLive}>
          ▸ {t("终端实况")}
          {live ? ` · ${t("点开查看原始输出")}` : ""}
        </button>
      )}
      {liveShown && <EarlierButton hasMore={props.hasMore} loading={props.loadingEarlier} onLoad={props.onLoadEarlier} />}
      {liveShown && props.earlier && <div className="tr-live tr-live-old">{props.earlier}</div>}
      {liveShown && live && (
        <div className="tr-live">
          {turns && (
            <button className="tr-live-tag" onClick={props.onCollapseLive}>
              ▾ {t("终端实况")}{live ? ` · ${t("点击收起")}` : ""}
            </button>
          )}
          {"\n"}
          {live}
        </div>
      )}
      {!turns && !live && t("已连接,等待输出…")}
    </>
  );
}
