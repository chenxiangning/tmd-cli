/**
 * 入门课向导 —— overlay 挂点(看板同款「不透明覆盖、下层零回放」)。
 * 左轨课程列表(完成打勾)+ 右侧课页(目标/要点/终端演示/练习);进度经
 * academyProgress 持久化;Esc 收起(输入框聚焦时让位)。
 */
import { useEffect, useSyncExternalStore } from "react";
import { X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { getAcademyCourse } from "@kernel/academy";
import { markLessonDone, setLessonCursor, useCourseProgress } from "./academyProgress";
import { closeWizard, subscribeWizard, useWizardTarget } from "./academyStores";
import { LessonPane } from "./lessonPane";
import "./academy.css";

export function AcademyWizard() {
  const target = useSyncExternalStore(subscribeWizard, useWizardTarget);
  const course = target ? getAcademyCourse(target.cliId) : undefined;
  /* Esc 收板;输入框/文本域聚焦时让位(与内核快捷键惯例一致) */
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      closeWizard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);
  if (!target || !course) return null;
  return (
    <div className="academy-wizard-page">
      <WizardBody key={target.cliId} cliId={target.cliId} initialIdx={target.idx} />
      <span className="academy-hidden">{course.title}</span>
    </div>
  );
}

function WizardBody({ cliId, initialIdx }: { cliId: string; initialIdx: number }) {
  const course = getAcademyCourse(cliId);
  const progress = useCourseProgress(cliId);
  useEffect(() => {
    setLessonCursor(cliId, Math.max(0, Math.min(initialIdx, (course?.lessons.length ?? 1) - 1)));
  }, [cliId, initialIdx, course]);
  if (!course) return null;
  const lessons = course.lessons;
  const idx = Math.max(0, Math.min(progress.cur, lessons.length - 1));
  const lesson = lessons[idx];
  const goto = (next: number) => setLessonCursor(cliId, Math.max(0, Math.min(next, lessons.length - 1)));
  const finish = () => {
    markLessonDone(cliId, lesson.id, lessons.length);
    closeWizard();
  };
  return (
    <div className="academy-wizard">
      <div className="academy-wizard-head">
        <b>{t("{title} 入门 · {n} 课", { title: course.title.replace(/学堂$/, ""), n: lessons.length })}</b>
        <div className="academy-wiz-prog" aria-hidden>
          <i style={{ width: `${Math.round((progress.done.length / lessons.length) * 100)}%` }} />
        </div>
        <span className="academy-wiz-pct">{progress.done.length}/{lessons.length}</span>
        <button type="button" className="academy-wiz-x" onClick={closeWizard} aria-label={t("关闭")}>
          <X size={13} />
        </button>
      </div>
      <div className="academy-wiz-body">
        <aside className="academy-rail">
          {(() => {
            const doneSet = new Set(progress.done);
            return lessons.map((l, i) => {
              const done = doneSet.has(l.id);
              return (
                <button key={l.id} type="button" className={`academy-step${i === idx ? " is-on" : ""}${done ? " is-done" : ""}`} onClick={() => goto(i)}>
                  <span className="academy-step-no">{done ? "✓" : i + 1}</span>
                  <span className="academy-step-t">
                    {l.title}
                    <small>{done ? t("已完成") : l.sub}</small>
                  </span>
                </button>
              );
            });
          })()}
        </aside>
        <LessonPane
          cliId={cliId}
          course={course}
          lesson={lesson}
          index={idx}
          isLast={idx === lessons.length - 1}
          onPrev={() => goto(idx - 1)}
          onNext={() => { markLessonDone(cliId, lesson.id, lessons.length); goto(idx + 1); }}
          onFinish={finish}
        />
      </div>
    </div>
  );
}
