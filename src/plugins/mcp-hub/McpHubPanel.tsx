/**
 * MCP 右栏概览面板 —— 每引擎一行(名称 + server 计数)+ 底部「打开管理」。
 * 计数来自 hubStore(声明 mcpGlobalConfig 的引擎;TOML 家 config 缺失不列);
 * 管理动作全部收口在中央 tab(右栏保持只读概览,与 git 聚合行同密度)。
 */
import { useEffect } from "react";
import { ArrowClockwise, ArrowSquareIn, Plugs, PlugsConnected } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "@kernel/useMinSpin";
import { useHubState, refreshHub, selectEngine, type McpEngineState } from "./hubStore";
import { openMcpHubTab } from "./hubTab";

/* 读失败 = 持久条(role=alert + 重试;R6 契约):点名仍可进管理看
   原文与错误详情,重试走全量刷新。转圈态行内私有:多行同时失败时
   点任意行只转该行(此前共用面板级 useMinSpin,全行同转)。 */
function EngineErrorRow({ engine }: { engine: McpEngineState }) {
  const { spinning, spin } = useMinSpin();
  return (
    <div
      role="alert"
      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs"
      data-mcphub-engine-error={engine.profileId}
    >
      <button
        type="button"
        onClick={() => {
          selectEngine(engine.profileId);
          openMcpHubTab();
        }}
        className="min-w-0 truncate text-left text-(--tmd-fg) hover:underline"
        title={engine.error}
      >
        {engine.name}
      </button>
      <span className="ml-3 flex flex-none items-center gap-1 text-(--tmd-diff-removed)">
        {t("读取失败")}
        <button
          type="button"
          onClick={() => spin(() => refreshHub())}
          title={t("重试")}
          aria-label={t("重试")}
          className="rounded p-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
          data-mcphub-engine-retry={engine.profileId}
        >
          {spinning ? <Spinner size="0.75rem" /> : <ArrowClockwise size="0.75rem" aria-hidden />}
        </button>
      </span>
    </div>
  );
}

export function McpHubPanel() {
  const { engines, loading, selectedProfileId } = useHubState();
  /* 面板激活即拉一次(中央 tab 与面板共用 store,已在则即时显示)。 */
  useEffect(() => {
    if (engines.length === 0 && !loading) void refreshHub();
  }, [engines.length, loading]);

  const total = engines.reduce((sum, e) => sum + (e.entries ? Object.keys(e.entries).length : 0), 0);

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div
        role="status"
        className="flex flex-none items-center gap-1.5 border-b border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted)"
      >
        <PlugsConnected size="0.75rem" className="text-(--tmd-accent)" aria-hidden />
        {t("MCP · {n} 台引擎 · {m} 个服务器", { n: engines.length, m: total })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {engines.map((engine) =>
          engine.entries === null ? (
            <EngineErrorRow key={engine.profileId} engine={engine} />
          ) : (
            <button
              key={engine.profileId}
              type="button"
              aria-pressed={engine.profileId === selectedProfileId}
              title={t("点击管理该引擎")}
              className={`relative flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                engine.profileId === selectedProfileId
                  ? "bg-(--tmd-bg-hover) font-medium text-(--tmd-fg) after:absolute after:inset-y-1 after:left-0 after:w-0.5 after:rounded-full after:bg-(--tmd-accent)"
                  : "hover:bg-(--tmd-bg-hover)"
              }`}
              onClick={() => {
                selectEngine(engine.profileId);
                openMcpHubTab();
              }}
            >
              <span className="min-w-0 truncate text-(--tmd-fg)">{engine.name}</span>
              <span className="ml-3 min-w-8 flex-none text-right text-(--tmd-fg-faint) tabular-nums">
                {engine.exists ? Object.keys(engine.entries).length : t("尚未创建")}
              </span>
            </button>
          ),
        )}
        {engines.length === 0 &&
          /* 忙态 = Spinner;空态 = 统一 Empty 形制(pi 脚注保留)。 */
          (loading ? (
            <div className="flex items-center justify-center gap-1.5 px-4 pt-8 text-xs text-(--tmd-fg-faint)">
              <Spinner />
              {t("加载中…")}
            </div>
          ) : (
            <Empty icon={<Plugs aria-hidden />}>{t("没有可管理的引擎")}</Empty>
          ))}
        <div className="px-3 py-1.5 text-meta text-(--tmd-fg-faint)">
          {t("pi:—(靠 pi-mcp-adapter 扩展)")}
        </div>
      </div>
      <button
        type="button"
        className="m-2 flex items-center justify-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border) py-1.5 text-xs text-(--tmd-fg-muted) transition-colors hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        onClick={openMcpHubTab}
      >
        <ArrowSquareIn size="0.75rem" aria-hidden />
        {t("打开管理")}
      </button>
    </div>
  );
}
