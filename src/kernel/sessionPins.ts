/**
 * 会话置顶层 —— settings.sessionPins 的领域 API(codemoss 双作用域置顶复刻)。
 *
 * 与 sessionTitles 同属应用侧覆盖层:不写回 CLI 磁盘文件,单一代码路径。
 * key = `${workspaceId}:${profileId}:${cliSessionId}` —— 未落盘的活会话
 * (无 cliSessionId) 不入层,右键菜单置灰,与重命名同规则。
 *
 * 双作用域(互斥由单 map 结构保证,一个 key 同一时刻只属于一个 scope):
 * - global:会话离开工作区分组,汇入左侧栏顶部「已置顶」区(跨工作区可见);
 * - workspace:会话固定在其 CLI 分组顶部,不参与磁盘历史分页。
 * pin 到另一作用域 = 迁移(旧时间戳不保留,与 codemoss pinThread 一致)。
 */

import {
  getSettingsState,
  updateSettings,
  type SessionPinEntry,
  type SessionPinScope,
} from "./settings";

export type { SessionPinEntry, SessionPinScope };

/** 置顶 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 三段身份缺一不可。 */
export function sessionPinKey(
  workspaceId: string,
  profileId: string,
  cliSessionId: string,
): string {
  return `${workspaceId}:${profileId}:${cliSessionId}`;
}

/** 解析置顶 key;非法结构返回 null(手改 JSON 兜底)。 */
export function parseSessionPinKey(
  key: string,
): { workspaceId: string; profileId: string; cliSessionId: string } | null {
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  if (first <= 0 || last <= first || last === key.length - 1) return null;
  return {
    workspaceId: key.slice(0, first),
    profileId: key.slice(first + 1, last),
    cliSessionId: key.slice(last + 1),
  };
}

/** 读取置顶记录;未置顶返回 undefined。 */
export function getSessionPin(key: string): SessionPinEntry | undefined {
  return getSettingsState().settings.sessionPins[key];
}

/** 是否已置顶;给 scope 则限定该作用域。 */
export function isSessionPinned(key: string, scope?: SessionPinScope): boolean {
  const entry = getSessionPin(key);
  return scope === undefined ? entry !== undefined : entry?.scope === scope;
}

/**
 * 置顶 / 迁移作用域。已以相同 scope 置顶时为 no-op(返回 false);
 * 否则写入新记录(新时间戳),结构性互斥无需显式清另一作用域。
 * title 为置顶时刻的显示标题快照(供全局区免磁盘扫描显示)。
 */
export function pinSession(
  key: string,
  scope: SessionPinScope,
  title: string,
): boolean {
  const current = getSettingsState().settings.sessionPins;
  if (current[key]?.scope === scope) return false;
  updateSettings({
    sessionPins: {
      ...current,
      [key]: { scope, pinnedAt: Date.now(), title },
    },
  });
  return true;
}

/** 取消置顶(不区分作用域);未置顶为 no-op。 */
export function unpinSession(key: string): void {
  const current = getSettingsState().settings.sessionPins;
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  updateSettings({ sessionPins: next });
}

/**
 * 切换置顶(codemoss 菜单语义):当前已是该 scope → 取消(返回 false);
 * 否则置顶/迁移到该 scope(返回 true)。
 */
export function toggleSessionPin(
  key: string,
  scope: SessionPinScope,
  title: string,
): boolean {
  if (isSessionPinned(key, scope)) {
    unpinSession(key);
    return false;
  }
  pinSession(key, scope, title);
  return true;
}

/** 指定 scope 的置顶列表(可按工作区/CLI 过滤,按置顶时间升序,最早置顶最上)。 */
export function listSessionPins(
  pins: Record<string, SessionPinEntry>,
  filter: { workspaceId?: string; profileId?: string; scope: SessionPinScope },
): Array<
  {
    key: string;
    entry: SessionPinEntry;
    workspaceId: string;
    profileId: string;
    cliSessionId: string;
  }
> {
  return Object.entries(pins)
    .flatMap(([key, entry]) => {
      if (entry.scope !== filter.scope) return [];
      const parsed = parseSessionPinKey(key);
      if (!parsed) return [];
      if (filter.workspaceId && parsed.workspaceId !== filter.workspaceId) return [];
      if (filter.profileId && parsed.profileId !== filter.profileId) return [];
      return [{ key, entry, ...parsed }];
    })
    .sort((a, b) => a.entry.pinnedAt - b.entry.pinnedAt);
}
