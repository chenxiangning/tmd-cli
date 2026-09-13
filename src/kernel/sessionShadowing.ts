/**
 * 影子会话登记 —— 插件后台会话对会话表的隔离原语(预热接管机制的宿主侧)。
 *
 * 动机:插件可在后台 spawn 不属于任何 tab 的辅助 PTY(如 cli-omp 的预热进程)。
 * 这类会话存在于 Rust 注册表(sessionList 全量可见),若不隔离,任何一次
 * setSessions / refreshSessions / readopt 都会把它们渗进活会话表 —— 侧栏凭空
 * 多行、状态轮询空转。登记为「影子」后,会话表合流点统一滤除;接管(转正)
 * 前必须解除登记,转正后与普通会话完全同权。
 *
 * 跨 webview 重载:重载清空前端一切运行时态,而 Rust 侧 PTY 照常存活 —— 影子
 * 集合同步写 sessionStorage(reload 不清,同 origin 会话存活),幂等的
 * restoreShadowSessions 先到先恢复;归属插件 activate 时按恢复的 id 清杀重载
 * 前的后台会话(进程必杀;app 冷启动 = 新 storage + Rust 空表,无孤儿)。
 */

const STORAGE_KEY = "tmd-cli/shadow-sessions";

const shadowed = new Set<string>();

/** 任何持久化失败(隐私模式/测试环境缺 storage)都只丢跨重载恢复,运行期过滤不受影响。 */
function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...shadowed]));
  } catch {
    /* 尽力而为 */
  }
}

/** 插件后台 spawn 后登记:该会话被会话表合流点滤除,直到解除或转正。 */
export function markShadowSession(sessionId: string): void {
  shadowed.add(sessionId);
  persist();
}

/** 解除登记(接管转正 / 进程清杀后);未知 id 幂等。 */
export function unmarkShadowSession(sessionId: string): void {
  shadowed.delete(sessionId);
  persist();
}

export function isShadowedSession(sessionId: string): boolean {
  return shadowed.has(sessionId);
}

/** 会话表合流点统一过滤(setSessions / refreshSessions / readopt missing)。 */
export function filterShadowSessions<T extends { id: string }>(list: T[]): T[] {
  if (shadowed.size === 0) return list;
  return list.filter((m) => !shadowed.has(m.id));
}

/**
 * 幂等恢复:从 sessionStorage 读回跨重载的影子 id(读后即清存储,集合为真相源)。
 * boot 早期与插件 activate 各自调用都安全 —— 先到者恢复,后来者拿到已恢复的集合。
 */
export function restoreShadowSessions(): string[] {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return [...shadowed];
  }
  if (raw) {
    try {
      for (const id of JSON.parse(raw) as string[]) shadowed.add(id);
    } catch {
      /* 损坏存储按空处理 */
    }
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 尽力而为 */
  }
  persist();
  return [...shadowed];
}

/** 测试专用:清空集合与存储。 */
export function clearShadowSessionsForTest(): void {
  shadowed.clear();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 尽力而为 */
  }
}
