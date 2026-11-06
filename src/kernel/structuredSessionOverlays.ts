/**
 * RPC 会话覆盖层存储(重命名/静音)与存储域推导 —— 自 structuredSessionTabs
 * 拆出(300 行铁则)。存储域(scope)= 引擎+cwd+会话判别后缀:同引擎同 cwd
 * 并行多会话(base tab + `#{sessionId}` resume tab)各自成域,草稿/重命名/
 * 静音互不串写;base 域 = 旧键形态,已持久数据零迁移。读 fallback:scoped 域
 * (含 #)miss 时回落 base 域 —— 会话存活期写在 base 域的改名/静音,经
 * 「结束账本 → resume 重开」(tab 带 # 后缀)后仍连续。静音 unmute 在 scoped
 * 域写 "0" 显式遮蔽 base 域(写 null 会令 base 值复活);重命名清除无 UI 路径,
 * 不做遮蔽。草稿键不 fallback(resume 会话从零起,防带入并行会话残留草稿,
 * 见 ssDraft.ts)。
 * 消费方:structured-session(draft 域/静音查/自动标题闸)+ workspace(行
 * 重命名/静音菜单);先例 structuredSessionEnded.ts(同族自有键族,kernel
 * 行投影的配套存储)。
 */

/** 存储域:resume 会话带 `#{sessionId}` 判别后缀(与 openStructuredSessionTab
 *  的 tab id 后缀同源);base = 引擎+cwd(旧键兼容,零迁移)。 */
export function ssScope(payload: { profileId: string; cwd: string; resumeSessionId?: string }): string {
  return payload.resumeSessionId
    ? `${payload.profileId}:${payload.cwd}#${payload.resumeSessionId}`
    : `${payload.profileId}:${payload.cwd}`;
}

const overlayKey = (scope: string, kind: "title" | "mute") => `tmd.ss.${kind}.${scope}`;

/** scoped 域 miss 时回落 base 域(仅读路径;scope 不含 # 时自等于 base)。 */
function readRaw(scope: string, kind: "title" | "mute"): string | null {
  try {
    const scoped = localStorage.getItem(overlayKey(scope, kind));
    if (scoped != null || !scope.includes("#")) return scoped;
    return localStorage.getItem(overlayKey(scope.slice(0, scope.indexOf("#")), kind));
  } catch {
    return null;
  }
}

export function readSsTitleOverride(scope: string): string | null {
  return readRaw(scope, "title");
}

export function noteSsTitleOverride(scope: string, title: string | null): void {
  try {
    if (title) localStorage.setItem(overlayKey(scope, "title"), title);
    else localStorage.removeItem(overlayKey(scope, "title"));
  } catch {
    /* 覆盖层缺失回落自动标题 */
  }
}

export function isSsMuted(scope: string): boolean {
  return readRaw(scope, "mute") === "1";
}

/** 静音切换:scoped 域写 "0" 显式遮蔽 base 域(防回落复活);base 域维持
 *  写 "1"/删键(无回落面)。 */
export function toggleSsMute(scope: string): boolean {
  const next = !isSsMuted(scope);
  try {
    if (next) localStorage.setItem(overlayKey(scope, "mute"), "1");
    else if (scope.includes("#")) localStorage.setItem(overlayKey(scope, "mute"), "0");
    else localStorage.removeItem(overlayKey(scope, "mute"));
  } catch {
    /* 静音态丢失只影响通知面 */
  }
  return next;
}
