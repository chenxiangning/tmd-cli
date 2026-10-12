/**
 * docgen 配置弹窗 —— 类型(模板库)/周期/范围/事实源/受众/引擎/附加指令/排程。
 * analysis 模板 = 纯提示词(生成即复制,不 spawn);项目详情入口以 lockedProject
 * 预锁范围。提交 → createEntry + 入队(真实 CLI 无头生成)。
 */
import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { buildAnalysisPrompt } from "../prompt";
import { createEntry, dimensionKeyOf, docgenSchedule, updateSchedule } from "./store";
import { enqueueDocGenTask } from "./queue";
import { DOCGEN_AUDIENCES, DOCGEN_PERIODS, DOCGEN_TEMPLATES, getDocGenTemplate, periodRange } from "./templates";
import type { DocGenSourceKey } from "./templates";
import type { Project } from "../types";

const WEEKDAY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" },
];

export function DocGenDialog({ lockedProject, projects, today, onClose, onToast }: {
  /** 项目详情入口:预锁单项目范围(范围 seg 隐藏)。 */
  lockedProject: Project | null;
  projects: readonly Project[];
  today: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const schedule = docgenSchedule();
  const [templateId, setTemplateId] = useState("weekly");
  const [period, setPeriod] = useState("本周");
  const [scopeOne, setScopeOne] = useState(lockedProject !== null);
  const [oneProjectId, setOneProjectId] = useState(lockedProject?.id ?? projects[0]?.id ?? "");
  const [sources, setSources] = useState<DocGenSourceKey>({ journal: true, sessions: false, git: false });
  const [audience, setAudience] = useState("管理层");
  const [language, setLanguage] = useState("");
  const profiles = host.getCliProfiles();
  const [engine, setEngine] = useState(() => profiles.find((p) => p.id === "omp")?.id ?? profiles[0]?.id ?? "omp");
  const [additional, setAdditional] = useState("");
  const [schedOn, setSchedOn] = useState(false);
  const [schedWeekday, setSchedWeekday] = useState(schedule.weekday);
  const [schedTime, setSchedTime] = useState(schedule.time);
  const [busy, setBusy] = useState(false);
  const template = getDocGenTemplate(templateId);

  const scopeText = useMemo(() => {
    if (lockedProject) return t("已锁定:单项目 · {name}", { name: lockedProject.name });
    return scopeOne ? t("单项目") : t("全部项目");
  }, [lockedProject, scopeOne]);

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = getDocGenTemplate(id);
    if (tpl) {
      setSources({ ...tpl.defaultSources });
      setAudience(tpl.defaultAudience);
    }
  };
  const toggleSource = (key: keyof DocGenSourceKey) => setSources((s) => ({ ...s, [key]: !s[key] }));

  const submit = () => {
    if (!template || busy) return;
    if (template.analysisOnly) {
      const project = lockedProject ?? projects.find((p) => p.id === oneProjectId) ?? null;
      const content = buildAnalysisPrompt({ projects, project, today });
      void navigator.clipboard?.writeText(content).then(
        () => onToast(t("已生成进展分析提示词并复制(未 spawn 会话)")),
        () => onToast(t("复制失败")),
      );
      onClose();
      return;
    }
    const project = lockedProject ?? (scopeOne ? projects.find((p) => p.id === oneProjectId) ?? null : null);
    if (scopeOne && !project) {
      onToast(t("请先登记或选择一个项目"));
      return;
    }
    const range = periodRange(period, today);
    setBusy(true);
    void createEntry({
      templateId: template.id,
      title: `${template.label} · ${range.label}${project ? ` · ${project.name}` : ""}`,
      scope: project ? { kind: "one", projectId: project.id, projectName: project.name } : { kind: "all" },
      periodKey: range.key,
      periodLabel: range.label,
      periodFrom: range.from,
      periodTo: range.to,
      audience,
      engine,
      sources,
      additional: additional.trim() || undefined,
      language: language || undefined,
    }).then((entry) => {
      const queued = enqueueDocGenTask("手动生成", entry.id, dimensionKeyOf(entry.templateId, entry.scope, entry.periodKey), engine);
      if (schedOn) {
        /* M18:排程落盘失败不翻转状态(回滚内存态防假「运行中」),onToast 如实报错。 */
        void updateSchedule({ on: true, weekday: schedWeekday, time: schedTime, templateId: template.id, engine }).catch((e) => {
          void updateSchedule(schedule).catch(() => undefined);
          onToast(e instanceof Error ? e.message : String(e));
        });
      }
      onToast(queued ? t("已加入生成队列({engine})", { engine }) : t("同维度已有任务在队列/运行中"));
      onClose();
    }, (e) => {
      setBusy(false);
      onToast(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <DialogShell
      title={t("生成文档")}
      icon={null}
      width={860}
      locked={busy}
      onClose={onClose}
      footer={
        <div className="dg-dialog-foot">
          <span className="dg-hint">
            {template?.analysisOnly
              ? t("提示词类模板:生成后立即复制,不产生队列与落盘")
              : t("产物落盘并加入左侧「文档」列表,生成中可随时终止")}
          </span>
          <DialogActions
            confirmLabel={template?.analysisOnly ? t("生成并复制") : t("开始生成")}
            onConfirm={submit}
            onCancel={onClose}
            cancelLabel={t("取消")}
            submitting={busy}
          />
        </div>
      }
    >
      <div className="dg-dialog">
        <div className="dg-col">
          <div className="dg-fld">
            <span className="dg-lb">{t("类型(模板库)")}</span>
            <div className="dg-types">
              {DOCGEN_TEMPLATES.map((tpl) => (
                <button key={tpl.id} type="button" className={`dg-tcard${tpl.id === templateId ? " is-on" : ""}`} onClick={() => pickTemplate(tpl.id)}>
                  <span className="dg-tcard-name">{t(tpl.label)}</span>
                  <span className="dg-tcard-desc">{t(tpl.desc)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="dg-col">
          <div className="dg-fld">
            <span className="dg-lb">{t("周期")}</span>
            <div className="dg-seg">
              {DOCGEN_PERIODS.map((p) => (
                <button key={p} type="button" className={p === period ? "is-on" : ""} onClick={() => setPeriod(p)}>{t(p)}</button>
              ))}
            </div>
          </div>
          <div className="dg-fld">
            <span className="dg-lb">
              {t("范围")}
              {lockedProject ? <span className="dg-lockchip">{scopeText}</span> : null}
            </span>
            {!lockedProject ? (
              <>
                <div className="dg-seg">
                  <button type="button" className={!scopeOne ? "is-on" : ""} onClick={() => setScopeOne(false)}>{t("全部项目")}</button>
                  <button type="button" className={scopeOne ? "is-on" : ""} onClick={() => setScopeOne(true)}>{t("单项目")}</button>
                </div>
                {scopeOne ? (
                  <select className="dg-select" aria-label={t("选择项目")} value={oneProjectId} onChange={(e) => setOneProjectId(e.target.value)}>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="dg-fld">
            <span className="dg-lb">{t("事实源(勾选进 prompt)")}</span>
            <label className="dg-srcrow"><input type="checkbox" checked disabled />{t("项目摘要")}{t("(任务/进展/风险,恒选)")}</label>
            <label className="dg-srcrow"><input type="checkbox" checked={sources.journal} onChange={() => toggleSource("journal")} />{t("工作日志")}{t("(周期内 AI 日志)")}</label>
            <label className="dg-srcrow"><input type="checkbox" checked={sources.sessions} onChange={() => toggleSource("sessions")} />{t("会话摘录")}{t("(周期内 CLI 会话转录)")}</label>
            <label className="dg-srcrow">
              <input type="checkbox" checked={sources.git} disabled={lockedProject === null && !scopeOne} onChange={() => toggleSource("git")} />
              {t("Git 提交")}{t("(单项目绑定目录;全部项目范围不可用)")}
            </label>
            {template?.needsGit && !sources.git ? <p className="dg-warn">{t("该模板以 Git 提交为主要事实源,建议勾选。")}</p> : null}
          </div>
          <div className="dg-fld">
            <span className="dg-lb">{t("受众与语言")}</span>
            <div className="dg-seg">
              {DOCGEN_AUDIENCES.map((a) => (
                <button key={a} type="button" className={a === audience ? "is-on" : ""} onClick={() => setAudience(a)}>{t(a)}</button>
              ))}
            </div>
            <select className="dg-select" aria-label={t("书写语言")} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">{t("语言:跟随界面")}</option>
              <option value="zh">简体中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>
          <div className="dg-fld">
            <span className="dg-lb">{t("生成引擎")}</span>
            <div className="dg-engines">
              {profiles.map((p) => (
                <button key={p.id} type="button" className={`dg-chipbtn${p.id === engine ? " is-on" : ""}`} onClick={() => setEngine(p.id)}>
                  {p.name}
                  <small className="dg-engmode">{p.oneshotArgs ? t("无头") : p.oneshotStdin ? t("stdin") : t("TUI 兜底")}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="dg-fld">
            <span className="dg-lb">{t("附加指令")}</span>
            <textarea className="dg-textarea" rows={2} aria-label={t("附加指令")} value={additional} placeholder={t("如:重点突出数据网关的发布风险,控制在 400 字内")} onChange={(e) => setAdditional(e.target.value)} />
          </div>
          <div className="dg-fld">
            <label className="dg-schedrow">
              <input type="checkbox" checked={schedOn} onChange={(e) => setSchedOn(e.target.checked)} />
              {t("每周定时生成(同模板与口径)")}
            </label>
            {schedOn ? (
              <div className="dg-sched-cfg">
                <select className="dg-select dg-select-sm" aria-label={t("排程星期")} value={schedWeekday} onChange={(e) => setSchedWeekday(Number(e.target.value))}>
                  {WEEKDAY_OPTIONS.map((w) => <option key={w.value} value={w.value}>{t(w.label)}</option>)}
                </select>
                <input type="time" className="dg-select dg-select-sm" aria-label={t("排程时间")} value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
                <span className="dg-muted">{t("每周末未跑会自动补跑一次")}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
