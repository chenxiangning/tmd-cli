/**
 * 指南 tab —— 某一 CLI 的全量命令参考(章节 chips + 检索 + 命令教学卡)。
 * 课程来自 kernel/academy 注册表(payload.cliId 路由);未注册 = 空态。
 * sourceVersion 与装机引擎探针版本比对:漂移出提示条(不阻断,audit B5)。
 */
import { useEffect, useMemo, useState } from "react";
import { CaretRight, Copy, Flask, BookOpenText } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { copyText } from "@kernel/clipboard";
import { composerInsertRef, composerWakeRef } from "@kernel/composerExt";
import { getAcademyCourse, type AcademyCommand } from "@kernel/academy";
import { filterChapters, lessonIndexByChapter } from "./guideSearch";
import { courseVersionDrift } from "./courseVersion";
import { practiceGate } from "./practiceGate";
import { openWizard } from "./academyStores";
import "./academy.css";

/** 试一试:命令填入 composer 并唤出 / 候选;无 composer(欢迎页等)= false,
 *  调用方原地给「先开会话」引导,不再静默(audit B3)。
 *  wake 必须推迟到 insert 的 setState 提交之后(rAF):composer 的 setValue 非函数式,
 *  同帧连调时陈旧闭包会用旧草稿覆盖刚插入的命令(reviewer P1 实证)。 */
function tryCommand(name: string, cliId: string): boolean {
  if (practiceGate({ cliId, hasComposer: composerInsertRef.current != null, activeEngine: null })) {
    return false;
  }
  composerInsertRef.current?.(`/${name} `);
  requestAnimationFrame(() => composerWakeRef.current?.("/"));
  return true;
}

function CommandCard({ cmd, cliId, lessonIdx, onOpenLesson }: {
  cmd: AcademyCommand;
  cliId: string;
  lessonIdx?: number;
  onOpenLesson: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /* 「试一试」无输入框时的原地引导(欢迎页等;audit B3 的静默跳过收口)。 */
  const [needSession, setNeedSession] = useState(false);
  const copy = () => {
    void copyText(`/${cmd.name}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="academy-card">
      <button type="button" className="academy-card-head" onClick={() => setOpen(!open)}>
        <span className="academy-cmd-name">/{cmd.name}</span>
        <span className="academy-cmd-zh">{cmd.zh}</span>
        {/* 密集卡头行内箭头:10px 例外档(设计系统收口注释豁免) */}
        <CaretRight size="0.625rem" className={`academy-chev${open ? " is-open" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="academy-card-body">
          <p className="academy-detail">{cmd.detail}</p>
          {cmd.usage && <p className="academy-usage">usage: /{cmd.name} {cmd.usage}</p>}
          <div className="academy-exs">
            <div className="academy-ex-head">{t("示例 · 场景 / 操作 / 回显 / 预期")}</div>
            {cmd.examples.map((ex) => (
              /* key 掺回显串:同一命令可有多条同输入示例(resume/model/compact 实证) */
              <div key={`${ex.i}:${ex.o}`} className="academy-ex">
                <div className="academy-ex-sc">{ex.sc}</div>
                <div className="academy-ex-in">{ex.i}</div>
                <div className="academy-ex-out">{ex.o}</div>
                <div className="academy-ex-exp"><b>{t("预期")}</b>{ex.e}</div>
              </div>
            ))}
          </div>
          {cmd.how && (
            <p className="academy-how"><span>{t("在 tmd-cli 里")}</span>{cmd.how}</p>
          )}
          {cmd.subs && cmd.subs.length > 0 && (
            <div className="academy-subs">
              {cmd.subs.map((s) => (
                <div key={s.name} className="academy-sub-row">
                  <span className="academy-sub-name">{s.name}{s.usage ? ` ${s.usage}` : ""}</span>
                  <span className="academy-sub-en">{s.en}</span>
                </div>
              ))}
            </div>
          )}
          <div className="academy-card-acts">
            {lessonIdx !== undefined && (
              <button type="button" className="academy-btn" onClick={() => onOpenLesson(lessonIdx)}>
                <BookOpenText size="0.75rem" aria-hidden />{t("去学")}
              </button>
            )}
            <button type="button" className="academy-btn" onClick={() => setNeedSession(!tryCommand(cmd.name, cliId))}>
              <Flask size="0.75rem" aria-hidden />{t("试一试")}
            </button>
            <button type="button" className="academy-btn" onClick={copy}>
              <Copy size="0.75rem" aria-hidden />{copied ? t("已复制") : t("复制命令")}
            </button>
          </div>
          {needSession && (
            <p className="academy-practice-hint" role="status">
              {t("先打开任意工作区会话再试(当前页面没有命令输入框)")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** tab.payload 是 in-process unknown:小守卫校验后取 cliId(不 inline-cast)。 */
function cliIdOf(tab: EditorTab): string {
  const p: unknown = tab.payload;
  if (typeof p === "object" && p !== null && "cliId" in p && typeof p.cliId === "string") {
    return p.cliId;
  }
  return "";
}

export function GuideTab({ tab }: { tab: EditorTab }) {
  const cliId = cliIdOf(tab);
  const course = getAcademyCourse(cliId);
  const [kw, setKw] = useState("");
  /* 装机引擎探针版本(课程引擎的 command 探活):sourceVersion 漂移比对用。
     探测失败/引擎不在 = null 不提示(宁漏勿扰,不猜)。 */
  const [installed, setInstalled] = useState<string | null>(null);
  useEffect(() => {
    setInstalled(null);
    const command = host.getCliProfile(cliId)?.command;
    if (!command) return;
    let alive = true;
    void ipc.cliProbe(command)
      .then((r) => {
        if (alive && r.found && r.version) setInstalled(r.version);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [cliId]);
  const drift = course ? courseVersionDrift(course.sourceVersion, installed) : null;
  const lessonIdx = useMemo(
    () => (course ? lessonIndexByChapter(course.lessons) : new Map<string, number>()),
    [course],
  );
  if (!course) {
    return <div className="academy-guide-empty">{t("课程未注册(引擎插件未启用或版本过旧)")}</div>;
  }
  const result = filterChapters(course.chapters, kw);
  return (
    <div className="academy-guide">
      <div className="academy-guide-toolbar">
        <input
          className="academy-search"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder={t("搜索命令或功能,如 compact / 额度 / 分支")}
          aria-label={t("搜索命令")}
        />
        <span className="academy-hits">{kw ? t("命中 {n} 条", { n: result.total }) : t("共 {n} 条命令", { n: result.total })}</span>
        <span className="academy-version">{course.title} · {course.sourceVersion}</span>
      </div>
      {drift && (
        /* 课程过期提示条(不阻断):CLI 升级后命令面可能与课程出入。 */
        <div className="academy-version-drift" role="status">
          {t("课程基于 v{source} 提取,当前引擎 v{installed};命令面可能有出入,以引擎自身帮助为准", {
            source: drift.source,
            installed: drift.installed,
          })}
        </div>
      )}
      <div className="academy-chips tmd-scroll-hide">
        {course.chapters.map((ch, i) => (
          <button
            key={ch.id}
            type="button"
            className="academy-chip"
            onClick={() => document.getElementById(`academy-ch-${ch.id}`)?.scrollIntoView({ block: "start" })}
          >
            {i + 1} {ch.title}
          </button>
        ))}
      </div>
      <div className="academy-guide-scroll">
        {result.chapters.map(({ chapter, commands }) => (
          <section key={chapter.id} id={`academy-ch-${chapter.id}`} className="academy-chapter">
            <div className="academy-chapter-head">
              <span className="academy-ch-no">{String(course.chapters.indexOf(chapter) + 1).padStart(2, "0")}</span>
              <span className="academy-ch-title">{chapter.title}</span>
              <span className="academy-ch-count">{t("{n} 条", { n: commands.length })}</span>
              <span className="academy-ch-desc">{chapter.desc}</span>
            </div>
            <div className="academy-cards">
              {commands.map((cmd) => (
                <CommandCard
                  key={cmd.name}
                  cmd={cmd}
                  cliId={cliId}
                  lessonIdx={lessonIdx.get(chapter.id)}
                  onOpenLesson={(idx) => openWizard(cliId, idx)}
                />
              ))}
            </div>
          </section>
        ))}
        {result.total === 0 && <div className="academy-guide-empty">{t("没有匹配的命令")}</div>}
      </div>
    </div>
  );
}
