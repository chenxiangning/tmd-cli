/**
 * 会话分组段头 —— 分类折叠开关(CLI / 终端 / SSH 三组共用):
 * 品牌 logo 骑时间轴轨道(.cli-group-label-icon / 无 logo 回退空心环节点)不变,
 * 名称弹性伸展,右侧计数仅折叠态显示,chevron 指示状态。
 * 折叠态持久化由调用方经 useGroupCollapsed 完成,本组件纯展示。
 */

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function GroupHeader({
  label,
  icon,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  /** 段头 logo(12px);缺省回退 CSS 空心环节点。 */
  icon?: ReactNode;
  /** 折叠态显示的会话数(展开后可见总数口径,由调用方装配)。 */
  count: number;
  collapsed: boolean;
  onToggle: () => void;
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
      <span className="cli-group-chevron" aria-hidden>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </span>
    </button>
  );
}
