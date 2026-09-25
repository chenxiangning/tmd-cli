/**
 * 学堂左栏入口 —— leftSidebar.section 挂点(order -1,排在工作区之前)。
 * 无课程注册 = 渲染 null(如 cli-* 全未启用);有课程:进度徽标 + 菜单
 * (继续入门 / 完整指南 / 结业速查 / 重置进度)。
 */
import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, Student } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useAcademyCourses } from "@kernel/academy";
import { useCourseProgress, resetProgress } from "./academyProgress";
import { openGuideTab, openWizard } from "./academyStores";
import "./academy.css";

export function AcademyEntry() {
  const courses = useAcademyCourses();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* 点外部收菜单(单入口局部弹层,不做全局浮层管理) */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  if (courses.length === 0) return null;
  return (
    <div className="academy-entry" ref={rootRef}>
      {courses.map((course) => (
        <EntryCourse
          key={course.cliId}
          cliId={course.cliId}
          title={course.title}
          lessonCount={course.lessons.length}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen(!menuOpen)}
          onDismiss={() => setMenuOpen(false)}
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
  const pct = lessonCount === 0 ? 0 : Math.round((progress.done.length / lessonCount) * 100);
  const subtitle = progress.done.length >= lessonCount
    ? t("已结业 · 指南随时查")
    : progress.done.length > 0
      ? t("已学 {done} / {total} 课", { done: progress.done.length, total: lessonCount })
      : t("{total} 课入门 + 命令指南", { total: lessonCount });
  const open = (idx: number) => {
    onDismiss();
    openWizard(cliId, idx);
  };
  return (
    <div className="academy-entry-course">
      <button type="button" className="academy-entry-btn" onClick={onToggleMenu} aria-expanded={menuOpen}>
        <span className="academy-entry-glyph" aria-hidden><Student size={13} /></span>
        <span className="academy-entry-tt">
          <b>{title}</b>
          <span>{subtitle}</span>
        </span>
        <span className="academy-entry-pct">{pct}%</span>
        {menuOpen ? <CaretDown size={10} aria-hidden /> : <CaretRight size={10} aria-hidden />}
      </button>
      {menuOpen && (
        <div className="academy-entry-menu">
          <button type="button" onClick={() => open(progress.cur)}>
            <b>{t("继续入门")}</b>
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
