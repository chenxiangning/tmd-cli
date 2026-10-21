/**
 * 会话查看 tab 深链(kernel 契约)—— workspace 会话行 view icon 点击开只读
 * 转录视图,不 spawn、不 attach、零 PTY 交互。tab 内容组件由 session-viewer
 * 插件经 registerTabContent 注册;同 fileTabs 先例:多个插件需要同一深链时
 * 契约收敛 kernel,插件间零直接依赖。
 */

import { getTabContent, getTabs, openTab } from "@kernel/tabs";
import type { CliProfile } from "./cliProfile";

/** tab kind(session-viewer 插件注册内容组件的匹配键)。 */
export const SESSION_VIEW_TAB_KIND = "session-view";

/** 行级定位载荷:幕布跳转不可达时的查看器兜底(needle 语义对齐 anchorJump)。 */
export interface SessionViewLocate {
  /** 期望命中的原文(通常 = 用户消息全文;查看器剥 @token 折叠空白后匹配)。 */
  text: string;
  /** 同文多轮出现序(1-based,缺省 1 取首条)。 */
  occurrence?: number;
}

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
  /** 行级定位(带 locate 的重开以 openTab refresh 刷 payload 重触发)。 */
  locate?: SessionViewLocate;
}

/** 查看器是否可用(行 view icon 的门控:内容组件未注册就不出图标)。 */
export function isSessionViewAvailable(): boolean {
  return getTabContent(SESSION_VIEW_TAB_KIND) !== undefined;
}

/** 打开会话只读转录 tab;同会话已开 = 激活既有 tab。带 locate 时 refresh ——
 *  openTab refresh 语义:激活并把 title/payload 刷成最新(深链重开场景
 *  payload 携带新的定位目标,组件按新对象引用重触发定位)。
 *  refresh 是整体覆盖,而寻址型深链(定位兜底)只带身份字段,不回填会把
 *  已开 tab 的富字段刷穷(title 退化 8 位 id、磁盘 path 丢失改走 listSessions
 *  全扫、modifiedAt 丢失),故缺省字段从既有 payload 补齐。 */
export function openSessionViewTab(payload: SessionViewTabPayload): void {
  const id = `session-view:${payload.profileId}:${payload.cliSessionId}`;
  const prev = getTabs().find((t) => t.id === id)?.payload as SessionViewTabPayload | undefined;
  const merged: SessionViewTabPayload = prev
    ? {
        ...prev,
        ...payload,
        title: payload.title ?? prev.title,
        path: payload.path ?? prev.path,
        modifiedAt: payload.modifiedAt ?? prev.modifiedAt,
        cwd: payload.cwd ?? prev.cwd,
      }
    : payload;
  openTab(
    {
      id,
      kind: SESSION_VIEW_TAB_KIND,
      title: merged.title || payload.cliSessionId.slice(0, 8),
      path: payload.cliSessionId,
      payload: merged,
    },
    payload.locate ? { refresh: true } : undefined,
  );
}

/** 幕布跳转 miss 兜底:开查看器并在该原文处定位;寻址字段由调用方给全,
 *  本函数不解析身份(checkpoints seeConversation / timeline miss 消费)。 */
export function openSessionViewAtText(
  base: Omit<SessionViewTabPayload, "locate">,
  text: string,
  occurrence = 1,
): void {
  openSessionViewTab({ ...base, locate: { text, occurrence } });
}

/** 查看深链装配:引擎支持转录 + 查看器已注册才产回调(各会话行区共用)。 */
export function sessionViewOpener(
  profile: Pick<CliProfile, "id" | "readSessionTranscript">,
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
