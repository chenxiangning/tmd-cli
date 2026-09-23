/**
 * transcript 对话/操作分层渲染 —— SessionScreen 与 HistoryScreen 共用;
 * turns 来自 append-only 会话日志,解析后不重排不插入,下标即稳定身份
 * (key 用下标是语义正解,非图省事)。助手长文默认 clamp,点击展开。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import type { TranscriptTurn } from "@kernel/transcript";

/** 助手消息超过该行数默认折叠(窄屏一屏被一条长文吃满)。 */
const CLAMP_LINES = 8;

function AssistantMsg(props: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = props.text.split("\n");
  const long = lines.length > CLAMP_LINES;
  return (
    <div className="tr-asst" onClick={long ? () => setOpen((v) => !v) : undefined}>
      {long && !open ? lines.slice(0, CLAMP_LINES).join("\n") : props.text}
      {long && (
        <span className="tr-more">
          {open ? ` ▴ ${t("收起")}` : ` ▾ ${t("展开全文")}`}
        </span>
      )}
    </div>
  );
}

export function TurnsView(props: { turns: TranscriptTurn[] }) {
  return (
    <div className="tr">
      {props.turns.map((tn, i) =>
        tn.role === "tool" ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- append-only 日志,下标即身份(见头注)
          <div className="tr-tool" key={i}>
            ⚙ {tn.tool}
            {tn.text ? ` ${tn.text}` : ""}
          </div>
        ) : tn.role === "user" ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- 同上
          <div className="tr-user" key={i}>
            {tn.text}
          </div>
        ) : (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- 同上
          <AssistantMsg text={tn.text} key={i} />
        ),
      )}
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

/** 实况块内容:有对话时默认折叠(窄屏终端流不可读),点开看;无对话 = 全屏实况。 */
export function LiveBlock(props: {
  turns: TranscriptTurn[] | null;
  live: string;
  liveShown: boolean;
  onExpandLive: () => void;
  onCollapseLive: () => void;
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
