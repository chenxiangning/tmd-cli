/**
 * 会话手动命名覆盖层 —— settings.sessionTitles 的领域 API。
 *
 * 为什么不写回 CLI 磁盘文件(架构决策,同步于 docs/architecture/02-code-architecture.md):
 * - omp/pi 的 title 记录是定长 pad 覆写格式,改写有长度/并发风险;
 * - claude 的 summary 行、codex 的 rollout 均无原生 rename 概念,追加异构行有解析破坏风险;
 * - 覆盖层对所有 CLI 行为一致,单一代码路径。
 * 代价:CLI 侧(如 omp /title)再改名不会回冲覆盖层 —— 手动命名优先,符合用户预期。
 */
import { getSettingsState, updateSettings } from "./settings";

/** 会话 id 短显:UUIDv7 类 id 前 8 位是时间戳,近缘会话必然撞前缀 → 头 4 + 尾 4。 */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** 覆盖层 key:`${profileId}:${cliSessionId}` —— 与 CLI 无关的活会话 PTY id 不入层。 */
export function sessionTitleKey(profileId: string, cliSessionId: string): string {
  return `${profileId}:${cliSessionId}`;
}

/** 读取手动命名;未命名返回 undefined。 */
export function getSessionTitle(
  profileId: string,
  cliSessionId: string,
): string | undefined {
  return getSettingsState().settings.sessionTitles[
    sessionTitleKey(profileId, cliSessionId)
  ];
}

/** 写入/更新手动命名(空标题 = 删除,回归磁盘原生标题)。 */
export function setSessionTitle(
  profileId: string,
  cliSessionId: string,
  title: string,
): void {
  const key = sessionTitleKey(profileId, cliSessionId);
  const current = getSettingsState().settings.sessionTitles;
  const trimmed = title.trim();
  const next = { ...current };
  if (trimmed) {
    next[key] = trimmed;
  } else {
    delete next[key];
  }
  updateSettings({ sessionTitles: next });
}

/** 删除命名(会话被物理删除时顺手清层,防残留)。 */
export function removeSessionTitle(profileId: string, cliSessionId: string): void {
  setSessionTitle(profileId, cliSessionId, "");
}
