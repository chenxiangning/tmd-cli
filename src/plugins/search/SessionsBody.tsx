/** 会话检索域(sessions kind 本体):session-search 禁用或无工作区不渲染
 *  (对应命令即不注册,此处只是壳内防御;不偷偷启用其索引)。导出供契约测试。 */
import { useSettingsState } from "@kernel/settings";
import { getActiveWorkspace } from "@kernel/workspace";
import { SessionSearchBody } from "@plugins/session-search/SearchBody";
import { closeSearchOverlay } from "./overlayStore";

export function SessionsBody() {
  const { settings } = useSettingsState();
  if (settings.disabledPlugins.includes("session-search")) return null;
  if (!getActiveWorkspace()) return null;
  return <SessionSearchBody open onRequestClose={closeSearchOverlay} />;
}
