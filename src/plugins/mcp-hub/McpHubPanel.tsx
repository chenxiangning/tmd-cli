/**
 * MCP 右栏概览面板 —— 每引擎一行(名称 + server 计数)+ 底部「打开管理」。
 * 计数来自 hubStore(声明 mcpGlobalConfig 的引擎;TOML 家 config 缺失不列);
 * 管理动作全部收口在中央 tab(右栏保持只读概览,与 git 聚合行同密度)。
 */
import { useEffect } from "react";
import { PlugsConnected, ArrowSquareIn } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useHubState, refreshHub } from "./hubStore";
import { openMcpHubTab } from "./hubTab";

export function McpHubPanel() {
  const { engines, loading } = useHubState();
  /* 面板激活即拉一次(中央 tab 与面板共用 store,已在则即时显示)。 */
  useEffect(() => {
    if (engines.length === 0 && !loading) void refreshHub();
  }, [engines.length, loading]);

  const total = engines.reduce((sum, e) => sum + (e.entries ? Object.keys(e.entries).length : 0), 0);

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div
        role="status"
        className="flex flex-none items-center gap-1.5 border-b border-(--tmd-border) px-3 py-1.5 text-[0.6875rem] leading-[1.125rem] text-(--tmd-fg-muted)"
      >
        <PlugsConnected size={11} className="text-(--tmd-accent)" aria-hidden />
        {t("MCP · {n} 台引擎 · {m} 个服务器", { n: engines.length, m: total })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {engines.map((engine) => (
          <div
            key={engine.profileId}
            className="flex items-center justify-between px-3 py-1.5 text-[0.6875rem] leading-[1.125rem]"
          >
            <span className="min-w-0 truncate text-(--tmd-fg)">{engine.name}</span>
            <span
              className={
                engine.entries === null
                  ? "ml-3 min-w-8 flex-none text-right text-(--tmd-diff-removed)"
                  : "ml-3 min-w-8 flex-none text-right text-(--tmd-fg-faint) tabular-nums"
              }
            >
              {engine.entries === null ? t("读取失败") : engine.exists ? Object.keys(engine.entries).length : t("尚未创建")}
            </span>
          </div>
        ))}
        {engines.length === 0 && (
          <div className="px-4 pt-8 text-center text-[0.6875rem] leading-relaxed text-(--tmd-fg-faint)">
            {loading ? t("正在扫描…") : t("没有可管理的引擎")}
          </div>
        )}
        <div className="px-3 py-1.5 text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-faint)">
          {t("pi:—(靠 pi-mcp-adapter 扩展)")}
        </div>
      </div>
      <button
        type="button"
        className="m-2 flex items-center justify-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border) py-1.5 text-[0.6875rem] text-(--tmd-fg-muted) transition-colors hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        onClick={openMcpHubTab}
      >
        <ArrowSquareIn size={12} aria-hidden />
        {t("打开管理")}
      </button>
    </div>
  );
}
