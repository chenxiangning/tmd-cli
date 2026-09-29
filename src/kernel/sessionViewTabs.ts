/**
 * 会话查看 tab 深链(kernel 契约)—— workspace 会话行 view icon 点击开只读
 * 转录视图,不 spawn、不 attach、零 PTY 交互。tab 内容组件由 session-viewer
 * 插件经 registerTabContent 注册;同 fileTabs 先例:多个插件需要同一深链时
 * 契约收敛 kernel,插件间零直接依赖。
 */

import { getTabContent, openTab } from "@kernel/tabs";

/** tab kind(session-viewer 插件注册内容组件的匹配键)。 */
export const SESSION_VIEW_TAB_KIND = "session-view";

/** 查看 tab 的自定义负载(只对 session-viewer 的内容组件有意义)。 */
export interface SessionViewTabPayload {
  profileId: string;
  cliSessionId: string;
  title?: string;
  modifiedAt?: number;
  /** 磁盘会话文件路径(磁盘行直传;各解析器按它定位)。 */
  path?: string;
  /** 会话 cwd(活会话行无磁盘 path 时,查看器经 listSessions 兜底定位)。 */
  cwd?: string;
}

/** 查看器是否可用(行 view icon 的门控:内容组件未注册就不出图标)。 */
export function isSessionViewAvailable(): boolean {
  return getTabContent(SESSION_VIEW_TAB_KIND) !== undefined;
}

/** 打开会话只读转录 tab;同会话已开 = 激活既有 tab。 */
export function openSessionViewTab(payload: SessionViewTabPayload): void {
  openTab({
    id: `session-view:${payload.profileId}:${payload.cliSessionId}`,
    kind: SESSION_VIEW_TAB_KIND,
    title: payload.title || payload.cliSessionId.slice(0, 8),
    path: payload.cliSessionId,
    payload,
  });
}

/** 查看深链装配:引擎支持转录 + 查看器已注册才产回调(各会话行区共用)。 */
export function sessionViewOpener(
  profile: Pick<import("./cliProfile").CliProfile, "id" | "readSessionTranscript">,
  cliSessionId: string | undefined,
  title: string,
  locate: { path?: string; cwd?: string },
): (() => void) | undefined {
  if (!cliSessionId || !profile.readSessionTranscript || !isSessionViewAvailable()) {
    return undefined;
  }
  return () =>
    openSessionViewTab({
      profileId: profile.id, cliSessionId, title,
      path: locate.path, cwd: locate.cwd,
    });
}
