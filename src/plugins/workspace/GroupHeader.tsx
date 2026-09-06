/**
 * 会话分组段头 —— 分类折叠开关(CLI / 终端 / SSH 三组共用):
 * 品牌 logo 骑时间轴轨道(.cli-group-label-icon / 无 logo 回退空心环节点)不变,
 * 名称弹性伸展,右侧计数仅折叠态显示,chevron 指示状态。
 * 折叠态持久化由调用方经 useGroupCollapsed 完成,本组件纯展示。
 * manage:CLI 分组展开态注入的「会话管理」开关 —— span 承载(段头本身是
 * button,禁嵌套 button,先例 PinToggle),hover 显形、激活常亮(CSS)。
 */

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

export function GroupHeader({
  label,
  icon,
  count,
  collapsed,
  onToggle,
  manage,
}: {
  label: string;
  /** 段头 logo(12px);缺省回退 CSS 空心环节点。 */
  icon?: ReactNode;
  /** 折叠态显示的会话数(展开后可见总数口径,由调用方装配)。 */
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** 会话管理开关;缺省不渲染(终端/SSH 组与折叠态无管理面)。 */
  manage?: { active: boolean; onToggle: () => void };
}) {
  return (
    <button
      type="button"
      className="cli-group-label"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? "展开分组" : "折叠分组"}
    >
      {icon ? (
        <span className="cli-group-label-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="cli-group-label-name">{label}</span>
      {collapsed && <span className="cli-group-count">{count}</span>}
      {manage && (
        <span
          role="button"
          tabIndex={0}
          aria-pressed={manage.active}
          aria-label="会话管理"
          title="会话管理"
          className={`cli-group-manage${manage.active ? " is-on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            manage.onToggle();
          }}
          onKeyDown={(e) => {
            /* 段头是 button:Enter/Space 已冒泡触发折叠,这里拦下避免双重激活。 */
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              manage.onToggle();
            }
          }}
        >
          <ListChecks size={12} aria-hidden />
        </span>
      )}
      <span className="cli-group-chevron" aria-hidden>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </span>
    </button>
  );
}
