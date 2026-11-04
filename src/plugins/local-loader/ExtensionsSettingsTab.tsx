/**
 * 「插件与扩展」设置 tab —— 管理入口说明 + 打开完整插件市场。
 *
 * 市场开合是 app-shell 的 shell.openMarket 命令;插件侧只经命令注册表调用,
 * 不反向 import app-shell(架构边界铁则)。命令缺失(如移动端)时禁用并说明。
 * 打开市场时必须先关闭设置面板(设置面板是更高层 overlay,会盖住市场),
 * 见 ./openPluginMarketFromSettings。
 */
import { ArrowSquareOut, Plugs } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useCommands } from "@kernel/shortcuts";
import { openPluginMarketFromSettings } from "./openPluginMarketFromSettings";

export function ExtensionsSettingsTab() {
  const openMarket = useCommands().find((c) => c.id === "shell.openMarket");
  return (
    <div className="flex flex-col gap-4 text-sm text-(--tmd-fg)">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-panel) p-4">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Plugs size="0.875rem" className="text-(--tmd-accent)" aria-hidden />
            {t("内置插件")}
          </div>
          <p className="m-0 leading-relaxed text-(--tmd-fg-muted)">
            {t("在插件市场插拔内置能力;变更写入启停清单,重启后生效。")}
          </p>
        </div>
        <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-panel) p-4">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Plugs size="0.875rem" className="text-(--tmd-accent)" aria-hidden />
            {t("本地插件")}
          </div>
          <p className="m-0 leading-relaxed text-(--tmd-fg-muted)">
            {t("管理 ~/.tmd-cli/plugins/ 下的本地插件:信任确认、免重启装载与版本回退。")}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="inline-flex w-fit items-center gap-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) px-3 py-1.5 transition-colors hover:bg-(--tmd-bg-hover) disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!openMarket}
        onClick={openPluginMarketFromSettings}
      >
        <ArrowSquareOut size="0.875rem" aria-hidden />
        {t("打开插件市场")}
      </button>
      {!openMarket && (
        <p className="m-0 text-(--tmd-fg-subtle)" role="status">
          {t("当前运行环境暂不支持打开插件市场。")}
        </p>
      )}
    </div>
  );
}
