/**
 * 会话定位实现 —— kernel/sessionReveal 桥的消费端(workspace 插件)。
 *
 * 单一区域原则决定展开目标(见 docs/architecture/05-sidebar-session-zones.md):
 * - scope=global 置顶 → 已置顶区(远程展开段折叠);
 * - 运行区候选(未置顶且 运行中/结束未查看)→ 运行区;
 * - 其余(无 pin / scope=workspace 留组)→ 工作区卡片(扁平化后分组恒展开,无段头补丁)。
 * 展开经 settings / 段 store 落地后,rAF 轮询(上限 600ms)等行渲染进树再滚动居中 +
 * is-reveal 闪高亮(1.6s 后移除,样式见 workspace-sessions-extras.css)。
 * 行锚点:活行 data-session-id / 磁盘行 data-cli-session-id(SessionRows 三行装配)。
 * 定位目标恒为活会话(tab 条只收活会话),归档等无行场景静默放弃。
 */

import type { RefObject } from "react";
import { host } from "@kernel/host";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { sessionPinKey } from "@kernel/sessionPins";
import { pinnedSection, runningSection } from "./sectionCollapsed";
import { isRunningZoneCandidate } from "./utils";

/** 返回的 handler 带 cancel():卸载时调用,终止在途 rAF 轮询;新请求亦取代旧轮询。 */
export function createSessionRevealHandler(
  sidebarRef: RefObject<HTMLElement | null>,
): ((sessionId: string) => void) & { cancel: () => void } {
  /* 代次闸:每次新请求或 cancel 递增,旧轮询下一帧自检即停(不上取消句柄表) */
  let generation = 0;
  const handler = (sessionId: string) => {
    const meta = host.getSessions().find((s) => s.id === sessionId);
    if (!meta) return;
    const st = getSettingsState().settings;
    const cliSessionId = host.getCliSessionId(sessionId);
    const pinKey =
      meta.workspaceId && cliSessionId !== undefined
        ? sessionPinKey(meta.workspaceId, meta.profileId, cliSessionId)
        : undefined;
    const pin = pinKey ? st.sessionPins[pinKey] : undefined;

    if (pin?.scope === "global") {
      /* 全局置顶:行在已置顶区,展开段即可(不惊动工作区折叠态) */
      pinnedSection.set(false);
    } else if (
      !pin &&
      meta.kind !== "ssh" &&
      meta.kind !== "shell" &&
      isRunningZoneCandidate(host.isTurnActive(sessionId), host.isUnread(sessionId))
    ) {
      /* 运行区候选(置顶优先级更高,已由上面分支排除) */
      runningSection.set(false);
    } else if (meta.workspaceId) {
      /* 组内行:无 pin / scope=workspace 留组顶块或活行;分组恒展开,只需展开工作区卡片 */
      if (st.workspaceCollapsedMap[meta.workspaceId] ?? true) {
        updateSettings({
          workspaceCollapsedMap: { ...st.workspaceCollapsedMap, [meta.workspaceId]: false },
        });
      }
    }

    /* 展开落地时机不定(重渲染 + 0.18s 网格过渡 + 慢机):rAF 轮询到行出现即定位,
     * 快路径一帧命中,上限 600ms 兜底;目标行恒为活会话,超时视为无行场景静默放弃。 */
    const gen = ++generation;
    const startedAt = performance.now();
    const tryReveal = () => {
      if (gen !== generation) return;
      const root = sidebarRef.current;
      const el =
        root?.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`) ??
        (cliSessionId !== undefined
          ? root?.querySelector<HTMLElement>(`[data-cli-session-id="${cliSessionId}"]`)
          : null);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("is-reveal");
        window.setTimeout(() => el.classList.remove("is-reveal"), 1600);
        return;
      }
      if (performance.now() - startedAt < 600) window.requestAnimationFrame(tryReveal);
    };
    window.requestAnimationFrame(tryReveal);
  };
  handler.cancel = () => {
    generation++;
  };
  return handler;
}
