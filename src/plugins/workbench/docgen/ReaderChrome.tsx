/**
 * docgen 阅读器 · 头部与状态件(无状态纯展示,从 DocGenReader 拆出守 300 行):
 * ReaderHead(标题/状态徽/版本 pills/三视图 seg)+ GenStateView(阶段条/终止)
 * + FailCard(失败卡/重试/换引擎)。
 */
import { Fragment } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { DOC_STATE_KEYS, readerMeta } from "../docgenView";
import { DG_GEN_STAGES, dgGenStageOf } from "./genSession";
import type { DocGenTask } from "./queue";
import type { DocGenEntry } from "./types";

export function ReaderHead({ entry, view, activeV, onVer, onView, onFlipState }: {
  entry: DocGenEntry;
  view: "s" | "d" | "r";
  activeV: number | null;
  onVer: (v: number) => void;
  onView: (v: "s" | "d" | "r") => void;
  onFlipState: () => void;
}) {
  const docStateLabel = t(DOC_STATE_KEYS[entry.docState]);
  const views = [
    { v: "s" as const, label: t("结构化"), show: true },
    { v: "d" as const, label: t("对比"), show: entry.versions.length > 1 },
    { v: "r" as const, label: t("原文"), show: true },
  ];
  return (
    <div className="dg-reader-head">
      <h3 className="dg-reader-title">{entry.title}</h3>
      {entry.status === "done" ? <span className="dg-badge">{t("AI 生成")}</span> : null}
      {entry.scheduled ? <span className="dg-badge dg-badge-sched">{t("排程")}</span> : null}
      {entry.status === "done" ? (
        <button type="button" className={`dg-docstate-${entry.docState}`} onClick={onFlipState} title={t("点击流转:草稿 → 已汇报 → 已归档")}>
          {docStateLabel}
        </button>
      ) : null}
      <span className="dg-reader-meta">{readerMeta(entry, activeV)}</span>
      <span className="dg-sp" />
      {entry.versions.length > 1 ? (
        <span className="dg-vers">
          {entry.versions.map((v) => (
            <button key={v.v} type="button" className={`dg-ver${(activeV ?? v.v) === v.v ? " is-on" : ""}`} onClick={() => onVer(v.v)}>v{v.v}</button>
          ))}
        </span>
      ) : null}
      {entry.status === "done" ? (
        <span className="dg-seg" role="tablist">
          {views.filter((x) => x.show).map((x) => (
            <button key={x.v} type="button" className={view === x.v ? "is-on" : ""} onClick={() => onView(x.v)}>{x.label}</button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export function GenStateView({ task, onTerminate }: { task?: DocGenTask; onTerminate: () => void }) {
  const stage = dgGenStageOf(task);
  return (
    <div className="dg-genstate">
      <div className="dg-stagebar">
        {DG_GEN_STAGES.map((label, i) => (
          <Fragment key={label}>
            <span className={`dg-stage${i < stage ? " is-done" : i === stage ? " is-run" : ""}`}>
              <i className="dg-sdot" />
              {t(label)}
            </span>
            {i < DG_GEN_STAGES.length - 1 ? <span className="dg-sline" /> : null}
          </Fragment>
        ))}
      </div>
      <p className="dg-gen-line">{task ? task.text : t("生成中")}</p>
      <p className="dg-gen-hint">{t("文件落盘即结算 · 20 分钟硬顶自动收割")}</p>
      <button type="button" className="wb-btn" onClick={onTerminate}>{t("终止生成")}</button>
    </div>
  );
}

export function FailCard({ entry, onRetry }: {
  entry: DocGenEntry;
  onRetry: (engine: string) => void;
}) {
  const profiles = host.getCliProfiles();
  const nextEngine = profiles[(profiles.findIndex((p) => p.id === entry.engine) + 1) % Math.max(1, profiles.length)]?.id ?? entry.engine;
  return (
    <div className="dg-failcard">
      <b>{t("生成失败")}</b>
      <p>{entry.error ?? t("产物未落盘")}</p>
      <div className="dg-fail-actions">
        <button type="button" className="wb-btn wb-btn-primary" onClick={() => onRetry(entry.engine)}>{t("重试")}</button>
        {nextEngine !== entry.engine ? <button type="button" className="wb-btn" onClick={() => onRetry(nextEngine)}>{t("换 {engine} 重试", { engine: nextEngine })}</button> : null}
      </div>
    </div>
  );
}
