/**
 * 指南 tab —— 某一 CLI 的全量命令参考(章节 chips + 检索 + 命令教学卡)。
 * 课程来自 kernel/academy 注册表(payload.cliId 路由);未注册 = 空态。
 */
import { useMemo, useState } from "react";
import { CaretRight, Copy, Flask, BookOpenText } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { composerInsertRef, composerWakeRef } from "@kernel/composerExt";
import { getAcademyCourse, type AcademyCommand } from "@kernel/academy";
import { filterChapters, lessonIndexByChapter } from "./guideSearch";
import { openWizard } from "./academyStores";
import "./academy.css";

/** 试一试:命令填入 composer 并唤出 / 候选(挂载期桥,欢迎页等无输入区 = 静默跳过)。
 *  wake 必须推迟到 insert 的 setState 提交之后(rAF):composer 的 setValue 非函数式,
 *  同帧连调时陈旧闭包会用旧草稿覆盖刚插入的命令(reviewer P1 实证)。 */
function tryCommand(name: string): void {
  composerInsertRef.current?.(`/${name} `);
  requestAnimationFrame(() => composerWakeRef.current?.("/"));
}

function CommandCard({ cmd, lessonIdx, onOpenLesson }: {
  cmd: AcademyCommand;
  lessonIdx?: number;
  onOpenLesson: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(`/${cmd.name}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="academy-card">
      <button type="button" className="academy-card-head" onClick={() => setOpen(!open)}>
        <span className="academy-cmd-name">/{cmd.name}</span>
        <span className="academy-cmd-zh">{cmd.zh}</span>
        <CaretRight size={10} className={`academy-chev${open ? " is-open" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="academy-card-body">
          <p className="academy-detail">{cmd.detail}</p>
          {cmd.usage && <p className="academy-usage">usage: /{cmd.name} {cmd.usage}</p>}
          <div className="academy-exs">
            <div className="academy-ex-head">{t("示例 · 场景 / 操作 / 回显 / 预期")}</div>
            {cmd.examples.map((ex) => (
              <div key={ex.i} className="academy-ex">
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
                <BookOpenText size={12} aria-hidden />{t("去学")}
              </button>
            )}
            <button type="button" className="academy-btn" onClick={() => tryCommand(cmd.name)}>
              <Flask size={12} aria-hidden />{t("试一试")}
            </button>
            <button type="button" className="academy-btn" onClick={copy}>
              <Copy size={12} aria-hidden />{copied ? t("已复制") : t("复制命令")}
            </button>
          </div>
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
      <div className="academy-chips">
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
        {result.chapters.map(({ chapter, commands }, i) => (
          <section key={chapter.id} id={`academy-ch-${chapter.id}`} className="academy-chapter">
            <h2>
              <span className="academy-ch-no">{String(i + 1).padStart(2, "0")}</span>
              {chapter.title}
              <small>{chapter.desc}</small>
            </h2>
            <div className="academy-cards">
              {commands.map((cmd) => (
                <CommandCard
                  key={cmd.name}
                  cmd={cmd}
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
