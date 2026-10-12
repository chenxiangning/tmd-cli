/**
 * docgen 阅读器 · 结构化区块(概览/项目进展/风险与阻塞/行动项/建议)。
 * 条目按钮 = 转任务(置绿防重);溯源 chip 点击上抛(Reader 统一 toast/跳转)。
 */
import { lazy, Suspense, useState } from "react";
import { t } from "@kernel/i18n";
import { retryImport } from "@kernel/lazyImport";
/* 跨插件 UI 复用先例(同 session-viewer→files、journal/articleBody):纯 props
   渲染件;md 重管线 lazy 拆包(同 DocEditor),不进主 chunk。 */
const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));
import { diffParsed, type DocGenParsed } from "./parse";
import { actionToItem, riskToItem, suggestionToItem, type TransferItem } from "../docgenView";

function SrcChip({ src, onJump }: { src?: string; onJump: (src: string) => void }) {
  if (!src) return null;
  return (
    <button type="button" className="dg-src" title={t("跳转来源")} onClick={() => onJump(src)}>{src}</button>
  );
}

export function DocGenBlocks({ parsed, md, transferred, onTransfer, onJumpSrc }: {
  parsed: DocGenParsed | null;
  md: string;
  /** 已转任务条目键(置绿防重)。 */
  transferred: ReadonlySet<string>;
  onTransfer: (item: TransferItem) => void;
  onJumpSrc: (src: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /* 行动项勾选:本地态(阅读期打勾不落盘;[x] 初态由解析器给)。
     md 异步到达:parsed 从 null 翻非空时须重置,不能只在挂载初值取一次。 */
  const [checkedActs, setCheckedActs] = useState<ReadonlySet<string>>(new Set());
  const [parsedFor, setParsedFor] = useState<DocGenParsed | null>(null);
  if (parsed !== parsedFor) {
    setParsedFor(parsed);
    setCheckedActs(new Set((parsed?.actions ?? []).filter((a) => a.checked).map((a) => actionToItem(a).key)));
  }
  if (!parsed) return <div className="dg-prose"><Suspense fallback={null}><MarkdownBody>{md}</MarkdownBody></Suspense></div>;
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };
  const toggleAct = (key: string) => {
    const next = new Set(checkedActs);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCheckedActs(next);
  };
  const transBtn = (item: TransferItem) => (
    <button
      type="button"
      className={`dg-w2t${transferred.has(item.key) ? " is-done" : ""}`}
      onClick={() => onTransfer(item)}
    >
      {item.kind === "suggestion"
        ? (transferred.has(item.key) ? t("已采纳") : t("采纳"))
        : (transferred.has(item.key) ? t("已转任务") : t("转任务"))}
    </button>
  );
  return (
    <div className="dg-blocks">
      <section className="dg-blk">
        <h4>{t("概览")}</h4>
        <div className="dg-overview"><Suspense fallback={null}><MarkdownBody>{parsed.overview.map((l) => (l.startsWith("-") ? l : `- ${l}`)).join("\n")}</MarkdownBody></Suspense></div>
      </section>
      {parsed.projects.map((p) => (
        <section key={p.name} className="dg-blk">
          <h4>
            <button type="button" className="dg-blk-toggle" aria-expanded={!collapsed.has(p.name)} onClick={() => toggle(p.name)}>{p.name}</button>
          </h4>
          {!collapsed.has(p.name) ? <div className="dg-prose"><Suspense fallback={null}><MarkdownBody>{p.lines.join("\n")}</MarkdownBody></Suspense></div> : null}
        </section>
      ))}
      <section className="dg-blk">
        <h4>{t("风险与阻塞")}<span className="dg-cnt">{parsed.risks.length}</span></h4>
        {parsed.risks.length === 0 ? <p className="dg-muted">{t("无")}</p> : parsed.risks.map((r) => {
          const item = riskToItem(r);
          return (
            <div key={item.key} className="dg-risk">
              <span className={`dg-sev dg-sev-${r.level}`}>{r.level}</span>
              <span className="dg-risk-text">{r.text}<SrcChip src={r.src} onJump={onJumpSrc} /></span>
              {transBtn(item)}
            </div>
          );
        })}
      </section>
      <section className="dg-blk">
        <h4>{t("行动项")}<span className="dg-cnt">{parsed.actions.length}</span></h4>
        {parsed.actions.length === 0 ? <p className="dg-muted">{t("无")}</p> : (
          <>
            <p className="dg-muted dg-act-hint">{t("勾选仅保留在当前阅读会话,不会回写文档")}</p>
            {parsed.actions.map((a) => {
          const item = actionToItem(a);
          const done = checkedActs.has(item.key);
          return (
            <div key={item.key} className={`dg-act${done ? " is-done" : ""}`}>
              <button type="button" className="dg-cb" aria-pressed={done} aria-label={t("勾选完成")} onClick={() => toggleAct(item.key)} />
              <span className="dg-act-text">{a.text}<SrcChip src={a.src} onJump={onJumpSrc} /></span>
              <span className="dg-act-meta">{[a.owner, a.due].filter(Boolean).join(" · ")}</span>
              {transBtn(item)}
            </div>
          );
            })}
          </>
        )}
      </section>
      <section className="dg-blk">
        <h4>{t("建议")}<span className="dg-cnt">{parsed.suggestions.length}</span></h4>
        {parsed.suggestions.length === 0 ? <p className="dg-muted">{t("无")}</p> : parsed.suggestions.map((s) => {
          const item = suggestionToItem(s);
          return (
            <div key={item.key} className="dg-sug">
              <span className="dg-sug-body">
                {s.text}
                {s.basis ? <small className="dg-sug-basis">{t("依据")}:{s.basis}</small> : null}
              </span>
              {transBtn(item)}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** 对比视图(相邻两版条目级 diff;展示件与结构化区块同居 Blocks)。
 *  上一版失败分口径:文件丢失出可重试错误卡(对齐当前版),格式问题才报不可解析。 */
export function DiffView({ cur, prev, prevErr, onRetryPrev }: {
  cur: DocGenParsed | null;
  prev: DocGenParsed | null | "loading";
  prevErr: boolean;
  onRetryPrev: () => void;
}) {
  if (prev === "loading") return <p className="dg-muted">{t("上一版本读取中…")}</p>;
  if (prevErr) {
    return (
      <div className="dg-failcard">
        <b>{t("上一版读取失败")}</b>
        <p>{t("上一版文件可能被移动或删除,可重试读取")}</p>
        <div className="dg-fail-actions">
          <button type="button" className="wb-btn wb-btn-primary" onClick={onRetryPrev}>{t("重试")}</button>
        </div>
      </div>
    );
  }
  if (!cur || !prev) return <p className="dg-muted">{t("版本不可解析,无条目级对比(可看原文)")}</p>;
  const items = diffParsed(prev, cur);
  if (items.length === 0) return <p className="dg-muted">{t("两版条目无差异")}</p>;
  /* key = 符号+文本+同文出现序(非数组下标):重复风险条目常见,下标键会在
   * 中段插入时错位复用;同文计数键稳定且消撞(F6)。 */
  const seen = new Map<string, number>();
  return (
    <div className="dg-diff">
      {items.map((item) => {
        const nth = seen.get(item.text) ?? 0;
        seen.set(item.text, nth + 1);
        return (
          <div key={`${item.sign}:${item.text}:${nth}`} className="dg-diff-row">
            <span className={`dg-sign dg-sign-${item.sign}`}>{item.sign === "add" ? "+" : item.sign === "del" ? "−" : "~"}</span>
            <span>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
