/**
 * 默认贡献器 —— AppShell 内嵌 UI 全部经挂点贡献,保持可替换。
 * 幂等注册:StrictMode 双调 / HMR 不会重复挂。
 *
 * 顶部 toolbar 只接 workspace breadcrumb 与少量 action 按钮;session 详情
 * 通过中央幕布承载(terminal + file tabs)。
 */

import { useMemo } from "react";
import { ChevronDown, Folder } from "lucide-react";
import { useHost } from "@kernel/host";
import type { MountContribution, MountPoint } from "@kernel/plugin";
import { useWorkspaces } from "@kernel/workspace";
import { deriveWorkspaceName } from "@kernel/pathUtils";

/** workspace 路径末段当 breadcrumb label。 */
function deriveLabel(root: string, fallbackName?: string): string {
  return (fallbackName ?? (deriveWorkspaceName(root) || "WORKSPACE")).toLowerCase();
}

/** 顶部 breadcrumb ─ codemoss 风格:folder icon + workspace 名 + chevron 下箭头。 */
function BreadcrumbDefault() {
  useHost();
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const label = useMemo(
    () => (active?.root ? deriveLabel(active.root, active?.name) : ""),
    [active],
  );

  if (!label) return null;

  return (
    <button
      type="button"
      className="workspace-breadcrumb"
      data-tauri-drag-region="false"
      title={active?.root}
    >
      <span className="workspace-breadcrumb-icon" aria-hidden>
        <Folder size={14} />
      </span>
      <span className="workspace-breadcrumb-label">{label}</span>
      <span className="workspace-breadcrumb-chevron" aria-hidden>
        <ChevronDown size={11} />
      </span>
    </button>
  );
}

/** 装配入口:由 main.tsx 调用,把内置 UI 注册到挂点。幂等。 */
let registered = false;
export function registerDefaultContributions(ctx: {
  contribute: (point: MountPoint, contribution: MountContribution) => void;
}): void {
  if (registered) return;
  registered = true;
  ctx.contribute("header.breadcrumb", {
    order: 100,
    component: BreadcrumbDefault,
  });
}