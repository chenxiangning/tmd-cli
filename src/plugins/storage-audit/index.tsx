/**
 * 存储管家插件 —— 磁盘体检(只读)+ 白名单清理。
 *
 * 体检:fs_dir_usage(Rust 只读递归)分桶统计 checkpoints/docgen/各家 CLI
 * 会话目录;CLI 目录红线 = 只报告不代删。
 * 清理:仅两个动作 —— checkpoints 按工作区走现成 checkpoint_prune,
 * docgen 已归档走索引回写 + 整目录删;全部二次确认。
 */

import { HardDrives } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { AuditTab } from "./AuditTab";
import { CleanupTab } from "./CleanupTab";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 单 tab 内容:体检面在上,清理面在下(单 tab section 不渲染 tab 条,平铺)。 */
function StorageTab() {
  return (
    <div>
      <AuditTab />
      <div className="my-4 border-t border-(--tmd-border)" />
      <CleanupTab />
    </div>
  );
}

export const storageAuditPlugin: Plugin = {
  id: "storage-audit",
  meta: {
    name: "存储管家",
    abbr: "SA",
    desc: "磁盘体检:checkpoints/docgen/各家 CLI 会话目录占用一目了然;白名单清理,CLI 目录零触碰",
    icon: HardDrives,
    iconColor: "#6C8EBF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerSettingsSection({
      id: "storage",
      title: t("存储体检"),
      description: t("磁盘占用体检与白名单清理;各家 CLI 会话目录只读零触碰。"),
      icon: <HardDrives size="0.875rem" aria-hidden />,
      order: 49, /* 尾部空位:现有 section 最大 order = intent-canvas 48 */
      tabs: [{ id: "storage", title: t("体检与清理"), order: 0, component: StorageTab }],
    });
  },
};
