/**
 * 每日文章 tab(详情即文件,不弹窗)—— 某一天的完整详情:标题/状态/会话清单 +
 * 文章本体(总览/分节/未完事项)+ 我的便签(B3 开编辑)。生成会话条 B4 接入。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { updateTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { host, useHost } from "@kernel/host";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { loadMonth, dayMetaOf, deriveDayStatus, getJournalState, useJournalState } from "./journalStore";
import { isRowSummarized, useDaySessions, todayKey, type DaySessionRow } from "./daySessions";
import { buildSessionLinks, openDaySessionRow } from "./sessionRef";
import { openSessionViewTab, isSessionViewAvailable } from "@kernel/sessionViewTabs";
import { useArticleEditSignal } from "./journalTabs";
import { ArticleDiscardGate } from "./ArticleDiscardGate";
import { KernelTopics } from "@kernel/events";
import { pad2 } from "./journalFiles";
import type { ArticleTabPayload } from "./journalTabs";
import { dayTitleOf } from "./dateTitle";
import { holOf, useHolidays } from "./holidays";
import { ArticleBody, BeadStrip, Lightbox } from "./articleBody";
import type { DayNoteImage } from "./journalFiles";
import { NoteEditor } from "./NoteEditor";
import { dayGenAction, statusChip } from "./statusText";
import { noteImageUrl } from "./noteAssets";
import { dayGenTaskType, enqueueTask, useGenTasks } from "./taskQueue";
import { EngMark } from "./EngMark";
import { TerminalWindow } from "@phosphor-icons/react";
import { DayLinks } from "./DayLinksCard";

function StatusHints({ st, sessionCount, lastError }: { st: string; sessionCount: number; lastError?: string }) {
  return (
    <>
      {/* 空日不再重复引导(NoteEditor 的「写便签」钮已是行动点;两处连播是噪声) */}
      {st === "f" && <div className="dj-art-hint dj-err">{lastError}</div>}
      {st === "p" && sessionCount > 0 && (
        <div className="dj-art-hint">{t("{n} 个会话等待提取。", { n: sessionCount })}</div>
      )}
    </>
  );
}


/** 顶栏状态 chip 组装(纯函数):该日生成任务活跃显示进行中态,否则当日状态。 */
function chipOf(liveTask: { st: string } | undefined, st: string): { cls: string; text: string } {
  if (liveTask) return { cls: " dj-chip-t", text: liveTask.st === "run" ? t("后台生成中") : t("排队中") };
  return { cls: ` dj-chip-${st === "n" ? "plain" : st}`, text: statusChip(st) };
}

/** 生成会话条:绑定会话在表 = 可打开干涉;已退出 = 只读标识。 */
function GenSessionBar({ sessionId, engine }: { sessionId?: string; engine?: string }) {
  useHost(); /* 订阅面(L15):会话退出即重渲染,live 判定不再僵死在旧表 */
  if (!sessionId) return null;
  const live = host.getSessions().some((s) => s.id === sessionId);
  return (
    <div className="dj-gensess">
      <TerminalWindow size="0.75rem" />
      <span className="dj-gensess-lab">{t("生成会话")}</span>
      <span className="dj-gensess-sub">
        <EngMark id={engine ?? ""} /> {engine ?? ""} · {sessionId}
      </span>
      {live && (
        <button type="button" className="dj-btn" onClick={() => { host.events.emit(KernelTopics.sessionViewRequested, null); host.setActiveSession(sessionId); }}>
          {t("打开会话(可干涉)")}
        </button>
      )}
      {!live && <span className="dj-chip dj-chip-plain">{t("会话已收尾")}</span>}
    </div>
  );
}

/** 手动发起总结(顶栏右侧,状态自适应):增量并入/生成此日/重试生成三态共用判定
 *  (dayGenAction);同日已有活跃任务给禁用态;两击确认防误触(月格同款)。 */
function GenAction({ y, m, d, st, hasArticle, rows, summarizedAt }: { y: number; m: number; d: number; st: string; hasArticle: boolean; rows: DaySessionRow[]; summarizedAt?: number }) {
  const tasks = useGenTasks();
  const key = `${y}-${pad2(m)}-${pad2(d)}`;
  const busy = tasks.some((t) => t.dayKey === key && (t.st === "run" || t.st === "queue"));
  const pendingCount = rows.filter((r) => !isRowSummarized(r, summarizedAt)).length;
  const act = dayGenAction(st, hasArticle, pendingCount, busy);
  const [confirming, setConfirming] = useState(false);
  if (act.kind === "none") return null;
  if (act.kind === "busy") {
    return (
      <button type="button" className="dj-btn dj-genaction" disabled title={t("后台任务面板可查进度")}>
        {t("生成任务进行中")}
      </button>
    );
  }
  const fire = () => {
    setConfirming(false);
    /* enqueueTask 日粒度闸同步拒双击:同日任意类型已有任务返回 null。 */
    enqueueTask(dayGenTaskType(st === "f", hasArticle), key, getJournalState().config.engine);
  };
  const click = () => {
    if (confirming) {
      fire();
      return;
    }
    setConfirming(true);
    setTimeout(() => setConfirming(false), 3000);
  };
  return (
    <button type="button" className={`dj-btn dj-genaction ${confirming ? "dj-btn-confirm" : "dj-btn-primary"}`} onClick={click}>
      {confirming ? t("再点一次确认生成") : act.label}
    </button>
  );
}

function DaySessions({ rows, summarizedAt, workspaces }: { rows: DaySessionRow[]; summarizedAt?: number; workspaces: readonly { id: string; root: string }[] }) {
  useHost(); /* 订阅面:活行身份绑定(getCliSessionId)与退出随时刷新 */
  if (rows.length === 0) return null;
  /* 转录链接装配:引擎支持转录 + 查看器在册才有;活行经已绑定磁盘身份定位。 */
  const viewOf = (r: DaySessionRow): (() => void) | undefined => {
    const profile = host.getCliProfile(r.profileId);
    const cliSessionId = r.disk?.id ?? (r.id !== undefined ? host.getCliSessionId(r.id) : undefined);
    if (!profile?.readSessionTranscript || !isSessionViewAvailable() || !cliSessionId) return undefined;
    const ws = workspaces.find((w) => w.id === r.wsId);
    const cwd = r.live && r.id ? host.getSessions().find((s) => s.id === r.id)?.cwd : ws?.root;
    return () =>
      openSessionViewTab({
        profileId: r.profileId, cliSessionId, title: r.title,
        path: r.disk?.path, cwd,
      });
  };
  return (
    <div className="dj-day-sessions">
      <h4>
        {t("当日会话")}
        {summarizedAt !== undefined && (
          <span className="dj-ds-count">
            {t("已归纳 {n}", { n: rows.filter((r) => isRowSummarized(r, summarizedAt)).length })} ·{" "}
            {t("待归纳 {n}", { n: rows.filter((r) => !isRowSummarized(r, summarizedAt)).length })}
          </span>
        )}
      </h4>
      {rows.map((r) => {
        const done = isRowSummarized(r, summarizedAt);
        const view = viewOf(r);
        return (
          <div key={`${r.profileId}-${r.startedAt}`} className="dj-ds-row">
            <EngMark id={r.profileId} />
            <span className="dj-ds-text">
              {r.profileId} · {r.title}
              {r.live ? ` · ${t("会话进行中")}` : ""}
            </span>
            <span className="dj-ds-ws">{r.wsName}</span>
            <button type="button" className="dj-ds-link" onClick={() => openDaySessionRow(r, workspaces)}>
              {t("打开会话")}
            </button>
            {view && (
              <button type="button" className="dj-ds-link" onClick={view}>
                {t("查看转录")}
              </button>
            )}
            {summarizedAt !== undefined && (
              <span className={`dj-chip ${done ? "" : "dj-chip-p"}`}>{done ? t("已归纳") : t("待归纳")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ArticleTab({ tab }: { tab: EditorTab }) {
  const p = tab.payload as ArticleTabPayload;
  const state = useJournalState();
  const { list } = useWorkspaces();
  const workspaces = useMemo(
    () => list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    [list],
  );
  const { days: sessions } = useDaySessions(workspaces, 0);
  const { y, m } = p;
  useEffect(() => {
    void loadMonth(y, m);
  }, [y, m, state.ready]);
  const snap = state.months[`${y}-${pad2(m)}`];
  const key = `${y}-${pad2(m)}-${pad2(p.d)}`;
  const rows = sessions ? (sessions.get(key) ?? []) : null;
  const article = snap?.articles[pad2(p.d)] ?? null;
  const note = snap?.notes[pad2(p.d)];
  const meta = dayMetaOf(key);
  const isToday = key === todayKey();
  const st = deriveDayStatus(article, isToday, rows?.length ?? 0, meta);
  /* 该日生成任务活跃即 chip 切进行中态(此前显示旧状态,用户不知已排上) */
  const tasks = useGenTasks();
  const liveTask = tasks.find((tk) => tk.dayKey === key && (tk.st === "run" || tk.st === "queue"));
  const chip = chipOf(liveTask, st);
  const [lightbox, setLightbox] = useState<DayNoteImage | null>(null);
  /* 脏稿统一持有(评审 M1):NoteEditor 上浮的脏态镜像 kernel tab 脏圆点
   * (updateTab 既有通道,文件 tab 同款)—— keepAlive 下切走不清点,圆点持续指认
   * 哪个页签有未保存草稿;卸载(= 关页签)时清点兜底。两条弃稿闸共用**本 tab 自己的**
   * ArticleDiscardGate:重开带草稿空日的放行确认,与关闭闸 beforeClose 的判据
   * 都是这个 dirty(2026-10-13)。 */
  const [dirty, setDirty] = useState(false);
  /* 变更回调里同步镜像,不等 effect 落地 —— 关闭闸读的是 kernel tab 上的
   * dirty,滞后一帧就可能让「刚敲完就 ⌘W」漏拦。 */
  const handleDirty = useCallback(
    (v: boolean) => {
      setDirty(v);
      updateTab(tab.id, { dirty: v });
    },
    [tab.id],
  );
  useEffect(() => {
    updateTab(tab.id, { dirty });
  }, [tab.id, dirty]);
  useEffect(
    () => () => updateTab(tab.id, { dirty: false }),
    [tab.id],
  );
  useHolidays();
  /* 会话引用链接面:当日行集四段归一键 → 续聊/聚焦(构建器在 sessionRef)。 */
  const sessionLinks = buildSessionLinks(rows, workspaces);
  /* 便签编辑重入信号:mount 时 autoEdit 起始,深链 refresh 再跳变(契约在 journalTabs);
     重挂即重开,脏态同步归零(放行闸判据,提交后评审 M2)。 */
  const editSignal = useArticleEditSignal(tab, () => setDirty(false));
  if (!snap || !rows)
    return (
      <div className="dj-article dj-article-loading">
        <ArticleDiscardGate tabId={tab.id} />
        <span className="dj-load">
          <Spinner /> {t("正在读取日志…")}
        </span>
      </div>
    );
  return (
    <div className="dj-article">
      <ArticleDiscardGate tabId={tab.id} />
      <div className="dj-art-bar">
        <span className="dj-art-date">{dayTitleOf(y, m, p.d)}</span>
        {holOf(y, m, p.d) && <span className="dj-holmini">休·{holOf(y, m, p.d)}</span>}
        <span className={`dj-chip${chip.cls}`}>{chip.text}</span>
        <span className="dj-art-sub">
          {[...new Set(rows.map((r) => r.profileId))].join(" / ")}
          {rows.length ? ` · ${t("{n} 会话", { n: rows.length })}` : ""}
        </span>
        <GenAction y={y} m={m} d={p.d} st={st} hasArticle={!!article} rows={rows} summarizedAt={meta.summarizedAt} />
      </div>
      <div className="dj-art-scroll">
        <div className="dj-art-page">
          <h1 className="dj-art-title">{article?.title || t("这一天没有 AI 会话")}</h1>
          <GenSessionBar sessionId={meta.sessionId} engine={meta.engine} />
          <StatusHints st={st} sessionCount={rows.length} lastError={meta.lastError} />
          <NoteEditor key={editSignal} y={y} m={m} d={p.d} note={note} signal={editSignal} onDirtyChange={handleDirty} onImageOpen={setLightbox} />
          {article && <ArticleBody article={article} sessionLinks={sessionLinks} />}
          <DaySessions rows={rows} summarizedAt={meta.summarizedAt} workspaces={workspaces} />
          <DayLinks rows={rows} />
          <BeadStrip beads={meta.beads} />
          {lightbox && noteImageUrl(lightbox.file) && (
            <Lightbox url={noteImageUrl(lightbox.file)} name={lightbox.name} onClose={() => setLightbox(null)} />
          )}
        </div>
      </div>
    </div>
  );
}
