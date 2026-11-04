/**
 * 从设置面板打开插件市场。
 *
 * 市场开合是 app-shell 的 shell.openMarket 命令;插件侧只经命令注册表调用,
 * 不反向 import app-shell(架构边界铁则)。
 *
 * 注意:设置面板是 app-shell 内更高层的 overlay,直接打开市场会被设置面板盖住,
 * 看似「没有任何反应」。必须先执行市场命令、再关闭设置面板。
 */
import { closeSettingsPanel } from "@kernel/settings";
import { getCommands } from "@kernel/shortcuts";

/** 先触发市场命令,再关闭设置面板避免遮挡。命令缺失(如移动端)时不动作。 */
export function openPluginMarketFromSettings(): void {
  const cmd = getCommands().find((c) => c.id === "shell.openMarket");
  if (!cmd) return;
  cmd.run();
  closeSettingsPanel();
}
