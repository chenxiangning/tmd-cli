/**
 * docgen 阅读器 —— 右栏:头(标题/状态徽/版本 pills/三视图 seg)+ 正文
 * (结构化区块 / 条目级对比 / 原文 markdown)+ 底部分发动作。
 * 状态机:done 看三视图;gen 看生成态(队列文案+终止);fail 看失败卡(重试)。
 */
import { useEffect, useMemo, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { DiffView, DocGenBlocks } from "./DocGenBlocks";
import { parseDocGenMarkdown, type DocGenParsed } from "./parse";
import { docgenPaths, readText } from "./paths";
import { createEntry, dimensionKeyOf, toggleDocState } from "./store";
import { cancelDocGenTask, enqueueDocGenTask, useDocGenTasks, type DocGenTask } from "./queue";
import { resolveTargetProjectId, riskToItem, actionToItem, suggestionToItem, type TransferItem } from "../docgenView";
import { FailCard, GenStateView, ReaderHead } from "./ReaderChrome";
import { WbConfirm } from "../ui";
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
  const [mdErr, setMdErr] = useState<Record<number, boolean>>({});
  const [lastEntryId, setLastEntryId] = useState(entry.id);
  /* 转任务乐观置灰(点击即点亮,不等工作台快照回写;失败回滚)+ 在途防双击。 */
  const [localTransferred, setLocalTransferred] = useState<ReadonlySet<string>>(new Set());
  const [confirmTerm, setConfirmTerm] = useState(false);
  /* 切换条目:渲染期调整状态(React 官方模式,替代 prop-change effect)。 */
  if (lastEntryId !== entry.id) {
    setLastEntryId(entry.id);
    setVer(null);
    setView("s");
    setMdByVer({});
    setMdErr({});
    setLocalTransferred(new Set());
    setConfirmTerm(false);
  }
  const activeV = ver ?? latestV;
  const md = activeV === null ? undefined : mdByVer[activeV];
  const curParsed = useMemo(() => (md ? parseDocGenMarkdown(md) : null), [md]);
  /* 已转任务防重(重进持久):转任务落 task.title = 条目文本前 80 字,据工作台快照派生,
     新转成功后快照更新自动点亮(spec:重进按来源已存在判定);并入本地乐观集。 */
  const transferred = useMemo(() => {
    const set = new Set<string>(localTransferred);
    if (!curParsed) return set;
    const titles = new Set(projects.flatMap((p) => p.tasks).map((x) => x.title));
    for (const r of curParsed.risks) { const it = riskToItem(r); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    for (const a of curParsed.actions) { const it = actionToItem(a); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    for (const s of curParsed.suggestions) { const it = suggestionToItem(s); if (titles.has(it.text.slice(0, 80))) set.add(it.key); }
    return set;
  }, [curParsed, projects, localTransferred]);
  /* 正文读取失败(null/reject)置 mdErr,阅读区出错误卡可重试;不进 mdByVer 防 effect 循环。 */
  const diffing = view === "d" && activeV !== null && activeV > 1;
  const prevMd = diffing ? mdByVer[activeV - 1] : undefined;
  /* 上一版读取失败与「版本不可解析」分口径:文件丢失出可重试错误卡,格式问题才报不可解析。 */
  const prevErr = diffing && !!mdErr[activeV - 1];
  const prevParsed: DocGenParsed | null | "loading" = !diffing
    ? null
    : prevMd === undefined ? "loading" : parseDocGenMarkdown(prevMd);

  useEffect(() => {
    if (activeV === null || mdByVer[activeV] !== undefined) return;
    readVersionInto(entry.id, activeV, (content) => setMdByVer((m) => ({ ...m, [activeV]: content })), () => setMdErr((m) => (m[activeV] ? m : { ...m, [activeV]: true })));
  }, [activeV, entry.id, mdByVer]);
  useEffect(() => {
    if (!diffing || mdByVer[activeV - 1] !== undefined) return;
    readVersionInto(entry.id, activeV - 1, (content) => setMdByVer((m) => ({ ...m, [activeV - 1]: content })), () => setMdErr((m) => (m[activeV - 1] ? m : { ...m, [activeV - 1]: true })));
  }, [diffing, activeV, entry.id, mdByVer]);
  /** 错误卡重试:清失败标记后按版本重读(主动触发,不依赖 effect 重跑)。 */
  const reloadMd = (v: number | null) => {
    if (v === null) return;
    setMdErr((m) => {
      if (!m[v]) return m;
      const next = { ...m };
      delete next[v];
      return next;
    });
    readVersionInto(entry.id, v, (content) => setMdByVer((m) => ({ ...m, [v]: content })), () => setMdErr((m) => (m[v] ? m : { ...m, [v]: true })));
  };

  const transfer = (item: TransferItem) => {
    const target = resolveTargetProjectId(entry, projects);
    if (!target.projectId) {
      onToast(t("没有可落的目标项目"));
      return;
    }
    /* 乐观置灰防双击:点击即标记,失败回滚(快照刷新窗口内不回亮也不会双建)。 */
    setLocalTransferred((s) => (s.has(item.key) ? s : new Set(s).add(item.key)));
    const desc = [item.src ? `来源:${item.src}` : "", `出自文档《${entry.title}》`].filter(Boolean).join(" · ");
    void addTask(target.projectId, {
      title: item.text.slice(0, 80),
      owner: item.owner,
      dueDate: item.due,
      description: desc,
    }).then(
      () => onToast(target.fallback ? t("已写入任务:{name}(默认第一个进行中项目)", { name: target.projectName }) : t("已写入任务:{name}", { name: target.projectName })),
      (e) => {
        setLocalTransferred((s) => {
          if (!s.has(item.key)) return s;
          const next = new Set(s);
          next.delete(item.key);
          return next;
        });
        onToast(errTextDisplay(e));
      },
    );
  };
  const jumpSrc = useDocGenJump(entry, projects, onToast);
  const flipDocState = () => {
    void toggleDocState(entry.id);
  };
  /* 终止与删文档口径齐(WbConfirm 二次确认):run 态收割真实会话,单击即执行太重。 */
  const terminate = () => {
    setConfirmTerm(false);
    if (!task || !cancelDocGenTask(task.id)) {
      onToast(t("任务已结束,无需终止"));
      return;
    }
    onToast(task.st === "run" ? t("已终止:收割会话并回落") : t("已取消排队任务"));
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
    }, (err) => onToast(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div className="dg-reader">
      <ReaderHead entry={entry} view={view} activeV={activeV} onVer={setVer} onView={setView} onFlipState={flipDocState} />
      <ReaderBody
        entry={entry}
        view={view}
        task={task}
        activeV={activeV}
        md={md}
        mdErr={mdErr}
        curParsed={curParsed}
        prevParsed={prevParsed}
        prevErr={prevErr}
        transferred={transferred}
        onTransfer={transfer}
        onJumpSrc={jumpSrc}
        onTerminate={() => setConfirmTerm(true)}
        onRetry={retryWith}
        onRetryMd={reloadMd}
      />
      <WbConfirm
        open={confirmTerm && entry.status === "gen" && !!task}
        title={t("终止生成")}
        body={t("终止后将收割生成会话,已落盘内容保留,可稍后重试。")}
        confirmLabel={t("终止")}
        onConfirm={terminate}
        onCancel={() => setConfirmTerm(false)}
      />
      {entry.status === "done" ? <ReaderFoot entry={entry} projects={projects} md={md} onToast={onToast} /> : null}
    </div>
  );
}

function ReaderBody({ entry, view, task, activeV, md, mdErr, curParsed, prevParsed, prevErr, transferred, onTransfer, onJumpSrc, onTerminate, onRetry, onRetryMd }: {
  entry: DocGenEntry;
  view: "s" | "d" | "r";
  task?: DocGenTask;
  activeV: number | null;
  md: string | undefined;
  mdErr: Record<number, boolean>;
  curParsed: DocGenParsed | null;
  prevParsed: DocGenParsed | null | "loading";
  prevErr: boolean;
  transferred: ReadonlySet<string>;
  onTransfer: (item: TransferItem) => void;
  onJumpSrc: (src: string) => void;
  onTerminate: () => void;
  onRetry: (engine: string) => void;
  onRetryMd: (v: number | null) => void;
}) {
  return (
    <div className="dg-reader-body">
      {entry.status === "gen" ? (
        <GenStateView task={task} onTerminate={onTerminate} />
      ) : entry.status === "fail" ? (
        <FailCard entry={entry} onRetry={onRetry} />
      ) : (
        <DoneBody
          view={view}
          activeV={activeV}
          md={md}
          mdErr={mdErr}
          curParsed={curParsed}
          prevParsed={prevParsed}
          prevErr={prevErr}
          transferred={transferred}
          onTransfer={onTransfer}
          onJumpSrc={onJumpSrc}
          onRetryMd={onRetryMd}
        />
      )}
    </div>
  );
}

/** done 态正文:加载/错误卡/对比/原文/结构化五分支(与 gen/fail 开关分层守复杂度)。 */
function DoneBody({ view, activeV, md, mdErr, curParsed, prevParsed, prevErr, transferred, onTransfer, onJumpSrc, onRetryMd }: {
  view: "s" | "d" | "r";
  activeV: number | null;
  md: string | undefined;
  mdErr: Record<number, boolean>;
  curParsed: DocGenParsed | null;
  prevParsed: DocGenParsed | null | "loading";
  prevErr: boolean;
  transferred: ReadonlySet<string>;
  onTransfer: (item: TransferItem) => void;
  onJumpSrc: (src: string) => void;
  onRetryMd: (v: number | null) => void;
}) {
  if (md === undefined) {
    if (activeV !== null && mdErr[activeV]) {
      return (
        <div className="dg-failcard">
          <b>{t("版本正文读取失败")}</b>
          <p>{t("文件可能被移动或删除,可重试读取")}</p>
          <div className="dg-fail-actions">
            <button type="button" className="wb-btn wb-btn-primary" onClick={() => onRetryMd(activeV)}>{t("重试")}</button>
          </div>
        </div>
      );
    }
    return <p className="dg-muted">{t("版本正文加载中…")}</p>;
  }
  if (view === "d") {
    if (activeV !== null && activeV < 2) return <p className="dg-muted">{t("首版没有上一版,无可比对内容")}</p>;
    return <DiffView cur={curParsed} prev={prevParsed} prevErr={prevErr} onRetryPrev={() => onRetryMd(activeV !== null ? activeV - 1 : null)} />;
  }
  if (view === "r") {
    return <div className="dg-prose"><pre className="dg-raw">{md}</pre></div>;
  }
  return <DocGenBlocks parsed={curParsed} md={md} transferred={transferred} onTransfer={onTransfer} onJumpSrc={onJumpSrc} />;
}

function loadVersionMd(entryId: string, v: number): Promise<string | null> {
  return docgenPaths().then((p) => readText(p.version(entryId, v)));
}

/** 读版本正文入状态:成功走 onOk,失败(null/reject)走 onFail(阅读区错误卡重试共用)。 */
function readVersionInto(entryId: string, v: number, onOk: (md: string) => void, onFail: () => void): void {
  void loadVersionMd(entryId, v).then((content) => (content === null ? onFail() : onOk(content)), onFail);
}

