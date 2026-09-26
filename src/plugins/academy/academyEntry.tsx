/**
 * 学堂左栏入口 —— leftSidebar.section 挂点(order -1,排在工作区之前)。
 * 无课程注册 = 渲染 null(如 cli-* 全未启用);有课程:进度徽标 + 菜单
 * (继续入门 / 完整指南 / 结业速查 / 重置进度)。
 */
import { useEffect, useRef, useState } from "react";
import { Student } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useAcademyCourses } from "@kernel/academy";
import { useCourseProgress, resetProgress } from "./academyProgress";
import { openGuideTab, openWizard } from "./academyStores";
import "./academy.css";

export function AcademyEntry() {
  const courses = useAcademyCourses();
  /* 展开的课程 cliId:多课程(多 CLI)时菜单互不共享(阶段 2+3 审查 P2)。 */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* 点外部收菜单(单入口局部弹层,不做全局浮层管理) */
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuFor]);

  if (courses.length === 0) return null;
  return (
    <div className="academy-entry" ref={rootRef}>
      {courses.map((course) => (
        <EntryCourse
          key={course.cliId}
          cliId={course.cliId}
          title={course.title}
          lessonCount={course.lessons.length}
          menuOpen={menuFor === course.cliId}
          onToggleMenu={() => setMenuFor(menuFor === course.cliId ? null : course.cliId)}
          onDismiss={() => setMenuFor(null)}
        />
      ))}
    </div>
  );
}

function EntryCourse({ cliId, title, lessonCount, menuOpen, onToggleMenu, onDismiss }: {
  cliId: string;
  title: string;
  lessonCount: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onDismiss: () => void;
}) {
  const progress = useCourseProgress(cliId);
  const done = progress.done.length;
  const finished = done >= lessonCount;
  const open = (idx: number) => {
    onDismiss();
    openWizard(cliId, idx);
  };
  return (
    <div className="academy-entry-course">
      <button type="button" className={`academy-entry-btn${menuOpen ? " is-on" : ""}`} onClick={onToggleMenu} aria-expanded={menuOpen}>
        <Student size={13} className="academy-entry-glyph" aria-hidden />
        <span className="academy-entry-tt">{title}</span>
        <span className="academy-entry-bar" aria-hidden><i style={{ width: `${Math.round((done / lessonCount) * 100)}%` }} /></span>
        <span className="academy-entry-pct">{finished ? t("已结业") : `${Math.round((done / lessonCount) * 100)}%`}</span>
      </button>
      {menuOpen && (
        <div className="academy-entry-menu">
          <button type="button" onClick={() => open(progress.cur)}>
            <b>{finished ? t("重温入门") : t("继续入门")}</b>
            <small>{t("第 {n} 课 / {total}", { n: Math.min(progress.cur + 1, lessonCount), total: lessonCount })}</small>
          </button>
          <button type="button" onClick={() => { onDismiss(); openGuideTab(cliId, `${title} · 指南`); }}>
            <b>{t("完整指南")}</b>
            <small>{t("全量命令")}</small>
          </button>
          <button type="button" onClick={() => open(lessonCount - 1)}>
            <b>{t("结业速查表")}</b>
            <small>{t("一屏总览")}</small>
          </button>
          <div className="academy-entry-sep" />
          <button type="button" className="is-danger" onClick={() => { resetProgress(cliId); onDismiss(); }}>
            <b>{t("重置学习进度")}</b>
          </button>
        </div>
      )}
    </div>
  );
}
