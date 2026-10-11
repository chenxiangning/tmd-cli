/**
 * 工作台 · 列表视图:项目/模块/状态/负责人/进度/截止/剩余/风险/任务数的紧凑表格。
 */

import { t } from "@kernel/i18n";
import { formatRemaining, openTasks, projectRisk } from "../analysis";
import { toneVar } from "../tone";
import { WbEmpty, WbProgress } from "../ui";
import type { WbScreenProps } from "./cards";

export function ListScreen({ projects, today, onOpen, onNewProject }: WbScreenProps) {
  if (projects.length === 0) {
    return <WbEmpty text={t("当前筛选下没有项目。")}><button type="button" className="wb-btn" onClick={onNewProject}>{t("新建项目")}</button></WbEmpty>;
  }
  return (
    <div className="wb-table-wrap">
      <table className="wb-table">
        <thead>
          <tr>
            <th>{t("项目")}</th>
            <th>{t("模块")}</th>
            <th>{t("状态")}</th>
            <th>{t("负责人")}</th>
            <th>{t("进度")}</th>
            <th>{t("截止")}</th>
            <th>{t("剩余")}</th>
            <th>{t("风险")}</th>
            <th>{t("任务")}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const risk = projectRisk(project, today);
            return (
              <tr key={project.id}>
                <td><button type="button" className="wb-link" onClick={() => onOpen(project.id)}>{project.name}</button></td>
                <td>{project.module || "其他项目"}</td>
                <td>{project.status}</td>
                <td>{project.owner || "未指定"}</td>
                <td className="wb-table-progress">
                  {/* flex 不能落在 td 上:td 脱离 table-cell 后 vertical-align:middle 失效,
                      匿名单元格内按块顶排 = 进度线浮到行高上半部,与同行文字错位。 */}
                  <span className="wb-progress-row">
                    <WbProgress value={project.progress} />
                    <span className="wb-progress-n">{project.progress}%</span>
                  </span>
                </td>
                <td>{project.dueDate ?? "—"}</td>
                <td>{formatRemaining(project.dueDate, today)}</td>
                <td><span style={{ color: toneVar(risk.tone) }}>{risk.label}</span></td>
                <td>{openTasks(project).length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
