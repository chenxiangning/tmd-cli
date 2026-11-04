/**
 * 「返回 AI 配置」导航(E-03)—— cli-config / assets 设置 tab 顶部的回链,
 * 关设置页并激活右栏 AI配置管理面板(home 即 AI 配置统一落地)。
 * 跨插件引用(memory-coordinator → cli-config/assets 方向)为叶子组件,
 * 无模块环;memory-coordinator 停用时面板未注册,链接整体不渲染。
 */

import { ArrowLeft } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { getFilePanels, setFilePanelMode } from "@kernel/filePanel";
import { closeSettingsPanel } from "@kernel/settings";

export function AiConfigBackLink() {
  /* AI配置管理面板未注册(memory-coordinator 停用)→ 无落地目标,不渲染死链。 */
  if (!getFilePanels().some((p) => p.id === "memory-files")) return null;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-meta text-(--tmd-fg-muted) transition-colors hover:text-(--tmd-accent)"
      onClick={() => {
        closeSettingsPanel();
        setFilePanelMode("memory-files");
      }}
    >
      <ArrowLeft size="0.75rem" aria-hidden />
      {t("返回 AI 配置")}
    </button>
  );
}
