/**
 * 课页 —— 目标/要点/终端打字演示/练习;结业课(cheat)渲染全章速查表。
 * 练习「试一试」= 命令填入 composer + 唤出 / 候选,再收向导(学完即上手)。
 */
import { useEffect, useRef } from "react";
import { Flask } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { AcademyCourse, AcademyLesson } from "@kernel/academy";
import { composerInsertRef, composerWakeRef } from "@kernel/composerExt";
import { markLessonDone } from "./academyProgress";

const TYPE_MS = 38;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m] ?? m);
}

/** 终端打字演示:逐字敲命令 + 回显按行浮现;demo 缺省 = 静态占位。 */
function TermDemo({ demo }: { demo: NonNullable<AcademyLesson["demo"]> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = "";
    const timers: number[] = [];
    let delay = 240;
    for (const [cmd, out] of demo) {
      const lineIn = document.createElement("div");
      lineIn.className = "academy-term-in";
      const lineOut = document.createElement("div");
      lineOut.className = "academy-term-out";
      root.append(lineIn, lineOut);
      let i = 0;
      const type = () => {
        if (i <= cmd.length) {
          lineIn.innerHTML = `${esc(cmd.slice(0, i))}<span class="academy-cursor" />`;
          i += 1;
          timers.push(window.setTimeout(type, TYPE_MS));
          return;
        }
        lineIn.textContent = cmd;
        out.split("\n").forEach((row, k) => {
          timers.push(window.setTimeout(() => {
            lineOut.innerHTML += `${esc(row)}\n`;
          }, 80 * (k + 1)));
        });
      };
      timers.push(window.setTimeout(type, delay));
      delay += cmd.length * TYPE_MS + out.length * 20 + 380;
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [demo]);
  return (
    <div className="academy-term" aria-hidden>
      <div className="academy-term-bar"><i /><i /><i /></div>
      <div ref={ref} />
    </div>
  );
}

export function LessonPane({ cliId, course, lesson, index, isLast, onPrev, onNext, onFinish }: {
  cliId: string;
  course: AcademyCourse;
  lesson: AcademyLesson;
  index: number;
  isLast: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const practice = (cmd: string) => {
    const name = cmd.replace(/^\//, "").split(/\s+/)[0];
    markLessonDone(cliId, lesson.id, course.lessons.length);
    composerInsertRef.current?.(`/${name} `);
    composerWakeRef.current?.("/");
    onFinish();
  };
  if (lesson.cheat) {
    return <CheatPane course={course} index={index} onPrev={onPrev} onFinish={onFinish} />;
  }
  return (
    <div className="academy-lesson">
      <h2>{index + 1}. {lesson.title}</h2>
      <p className="academy-lesson-goal">{lesson.goal}</p>
      {lesson.points.length > 0 && (
        <ul className="academy-points">
          {lesson.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
      {lesson.demo && <TermDemo demo={lesson.demo} />}
      {lesson.practice && (
        <div className="academy-practice">
          <div className="academy-practice-tt">
            <b>{t("练习:{p}", { p: lesson.practice })}</b>
            <p>{lesson.practiceWhy}</p>
          </div>
          <button type="button" className="academy-btn is-pri" onClick={() => practice(lesson.practice ?? "")}>
            <Flask size={12} aria-hidden />{t("试一试")}
          </button>
        </div>
      )}
      <LessonFooter index={index} isLast={isLast} onPrev={onPrev} onNext={onNext} onFinish={onFinish} />
    </div>
  );
}

function CheatPane({ course, index, onPrev, onFinish }: {
  course: AcademyCourse;
  index: number;
  onPrev: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="academy-lesson">
      <h2>{index + 1}. {t("结业:速查表与下一步")}</h2>
      <p className="academy-lesson-goal">{t("全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。")}</p>
      <div className="academy-cheat">
        {course.chapters.map((ch) => (
          <div key={ch.id} className="academy-cheat-card">
            <b>{ch.title}</b>
            {ch.commands.slice(0, 4).map((c) => (
              <div key={c.name} className="academy-cheat-row">
                <span>/{c.name}</span>
                <em>{c.zh}</em>
              </div>
            ))}
          </div>
        ))}
      </div>
      <LessonFooter index={index} isLast onPrev={onPrev} onNext={onFinish} onFinish={onFinish} />
    </div>
  );
}

function LessonFooter({ index, isLast, onPrev, onNext, onFinish }: {
  index: number;
  isLast: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="academy-lesson-foot">
      <span className="academy-lesson-note">{t("「试一试」会把命令填进对话框,关掉课程直接练")}</span>
      <span className="flex-1" />
      <button type="button" className="academy-btn" onClick={onPrev} disabled={index === 0}>{t("上一步")}</button>
      <button type="button" className="academy-btn is-pri" onClick={isLast ? onFinish : onNext}>
        {isLast ? t("完成") : t("下一步")}
      </button>
    </div>
  );
}
