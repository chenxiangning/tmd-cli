/**
 * docgen 阅读器 —— 右栏:头(标题/状态徽/版本 pills/三视图 seg)+ 正文
 * (结构化区块 / 条目级对比 / 原文 markdown)+ 底部分发动作。
 * 状态机:done 看三视图;gen 看生成态(队列文案+终止);fail 看失败卡(重试)。
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { DiffView, DocGenBlocks } from "./DocGenBlocks";
import { parseDocGenMarkdown, type DocGenParsed } from "./parse";
import { docgenPaths, readText } from "./paths";
import { createEntry, dimensionKeyOf, toggleDocState } from "./store";
import { cancelDocGenTask, enqueueDocGenTask, useDocGenTasks, type DocGenTask } from "./queue";
import { resolveTargetProjectId, readerMeta, riskToItem, actionToItem, suggestionToItem, DOC_STATE_KEYS, type TransferItem } from "../docgenView";
import { DG_GEN_STAGES, dgGenStageOf } from "./genSession";
import { addTask } from "../store";
import { useDocGenJump } from "./jump";
import { ReaderFoot } from "./DocGenFoot";
import type { DocGenEntry } from "./types";
import type { Project } from "../types";

export function DocGenReader({ entry, projects, onToast }: {
  entry: DocGenEntry;
  projects: readonly Project[];
  onToast: (m: string) => void;
}) {
  const tasks = useDocGenTasks();
  const task = tasks.find((x) => x.entryId === entry.id && (x.st === "queue" || x.st === "run"));
  const latestV = entry.versions[entry.versions.length - 1]?.v ?? null;
  const [ver, setVer] = useState<number | null>(null);
  const [view, setView] = useState<"s" | "d" | "r">("s");
  const [mdByVer, setMdByVer] = useState<Record<number, string>>({});
  const [lastEntryId, setLastEntryId] = useState(entry.id);
  /* 切换条目:渲染期调整状态(React 官方模式,替代 prop-change effect)。 */
  if (lastEntryId !== entry.id) {
    setLastEntryId(entry.id);
    setVer(null);
    setView("s");
    setMdByVer({});
  }
  const activeV = ver ?? latestV;
  const md = activeV === null ? undefined : mdByVer[activeV];
  const curParsed = useMemo(() => (md ? parseDocGenMarkdown(md) : null), [md]);
  /* 已转任务防重(重进持久):转任务落 task.title = 条目文本前 80 字,据工作台快照派生,
     新转成功后快照更新自动点亮(spec:重进按来源已存在判定)。 */
  const transferred = useMemo(() => {
    const set = new Set<string>();
    if (!curParsed) return set;
    const titles = new Set(projects.flatMap((p) => p.tasks).map((x) => x.title));
    for (const r of curParsed.risks) { const it = riskToItem(r); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    for (const a of curParsed.actions) { const it = actionToItem(a); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    for (const s of curParsed.suggestions) { const it = suggestionToItem(s); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    return set;
  }, [curParsed, projects]);
  const diffing = view === "d" && activeV !== null && activeV > 1;
  const prevMd = diffing ? mdByVer[activeV - 1] : undefined;
  const prevParsed: DocGenParsed | null | "loading" = !diffing
    ? null
    : prevMd === undefined ? "loading" : parseDocGenMarkdown(prevMd);

  useEffect(() => {
    if (activeV === null || mdByVer[activeV] !== undefined) return;
    void loadVersionMd(entry.id, activeV).then((content) => {
      if (content) setMdByVer((m) => ({ ...m, [activeV]: content }));
    });
  }, [activeV, entry.id, mdByVer]);
  useEffect(() => {
    if (!diffing || mdByVer[activeV - 1] !== undefined) return;
    void loadVersionMd(entry.id, activeV - 1).then((content) => {
      if (content) setMdByVer((m) => ({ ...m, [activeV - 1]: content }));
    });
  }, [diffing, activeV, entry.id, mdByVer]);

  const transfer = (item: TransferItem) => {
    const target = resolveTargetProjectId(entry, projects);
    if (!target.projectId) {
      onToast(t("没有可落的目标项目"));
      return;
    }
    const desc = [item.src ? `来源:${item.src}` : "", `出自文档《${entry.title}》`].filter(Boolean).join(" · ");
    void addTask(target.projectId, {
      title: item.text.slice(0, 80),
      owner: item.owner,
      dueDate: item.due,
      description: desc,
    }).then(
      () => onToast(target.fallback ? t("已写入任务:{name}(默认第一个进行中项目)", { name: target.projectName }) : t("已写入任务:{name}", { name: target.projectName })),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const jumpSrc = useDocGenJump(entry, projects, onToast);
  const flipDocState = () => {
    void toggleDocState(entry.id);
  };
  const retryWith = (engine: string) => {
    void createEntry({
      templateId: entry.templateId, title: entry.title, scope: entry.scope,
      periodKey: entry.periodKey, periodLabel: entry.periodLabel,
      periodFrom: entry.periodFrom, periodTo: entry.periodTo,
      audience: entry.audience, engine, sources: entry.sources,
      additional: entry.additional, language: entry.language,
    }).then((e) => {
      const queued = enqueueDocGenTask("重试生成", e.id, dimensionKeyOf(e.templateId, e.scope, e.periodKey), engine);
      onToast(queued ? t("已重新入队({engine})", { engine }) : t("同维度已有任务在队列/运行中"));
    });
  };

  return (
    <div className="dg-reader">
      <ReaderHead entry={entry} view={view} activeV={activeV} onVer={setVer} onView={setView} onFlipState={flipDocState} />
      <ReaderBody
        entry={entry}
        view={view}
        task={task}
        md={md}
        curParsed={curParsed}
        prevParsed={prevParsed}
        transferred={transferred}
        onTransfer={transfer}
        onJumpSrc={jumpSrc}
        onRetry={retryWith}
        onToast={onToast}
      />
      {entry.status === "done" ? <ReaderFoot entry={entry} projects={projects} md={md} onToast={onToast} /> : null}
    </div>
  );
}

function ReaderBody({ entry, view, task, md, curParsed, prevParsed, transferred, onTransfer, onJumpSrc, onRetry, onToast }: {
  entry: DocGenEntry;
  view: "s" | "d" | "r";
  task?: DocGenTask;
  md: string | undefined;
  curParsed: DocGenParsed | null;
  prevParsed: DocGenParsed | null | "loading";
  transferred: ReadonlySet<string>;
  onTransfer: (item: TransferItem) => void;
  onJumpSrc: (src: string) => void;
  onRetry: (engine: string) => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="dg-reader-body">
      {entry.status === "gen" ? (
        <GenStateView task={task} onTerminate={() => { if (task) cancelDocGenTask(task.id); onToast(t("已终止:收割会话并回落")); }} />
      ) : entry.status === "fail" ? (
        <FailCard entry={entry} onRetry={onRetry} />
      ) : view === "d" ? (
        <DiffView cur={curParsed} prev={prevParsed} />
      ) : view === "r" ? (
        <div className="dg-prose"><pre className="dg-raw">{md}</pre></div>
      ) : (
        <DocGenBlocks parsed={curParsed} md={md ?? ""} transferred={transferred} onTransfer={onTransfer} onJumpSrc={onJumpSrc} />
      )}
    </div>
  );
}

function loadVersionMd(entryId: string, v: number): Promise<string | null> {
  return docgenPaths().then((p) => readText(p.version(entryId, v)));
}

function ReaderHead({ entry, view, activeV, onVer, onView, onFlipState }: {
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

function GenStateView({ task, onTerminate }: { task?: DocGenTask; onTerminate: () => void }) {
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

function FailCard({ entry, onRetry }: {
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
