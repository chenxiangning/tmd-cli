/**
 * 会话 tab 标题解析 —— 自 SessionTabBar.tsx 拆出的纯函数(300 行铁则 +
 * only-export-components:组件文件只出组件)。SessionTab 与右键菜单共用。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";

/** 标题解析:手动命名 > 打开快照 > meta 标题 > 短码(与渲染优先级同源);meta 缺席 = 会话已逝。 */
export function resolveTabTitle(
  titleOverrides: Record<string, string>,
  id: string,
): string | undefined {
  const meta = host.getSessions().find((s) => s.id === id);
  if (!meta) return undefined;
  const cliSessionId = host.getCliSessionId(id);
  return (
    (cliSessionId
      ? titleOverrides[sessionTitleKey(meta.profileId, cliSessionId)]
      : undefined) ??
    getSessionTabTitle(id) ??
    meta.title ??
    shortId(meta.id)
  );
}

/** tab 悬停 title:等待确认/空闲态缀状态后缀(真值表见 kernel/sessionTabState)。 */
export function hoverTitle(state: string, title: string): string {
  if (state === "waiting") return t("{title} · 等待确认", { title });
  return state === "idle" ? t("{title} · 空闲", { title }) : title;
}
