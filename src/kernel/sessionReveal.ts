/**
 * 会话定位桥 —— 顶栏会话 tab「定位」按钮 → 侧栏 workspace 插件展开并滚动到该行。
 * 发起方(app-shell)与消费方(插件)不可互 import(R4),桥面必须落 kernel
 * (先例:terminalSearch 的 findRequestRef / workspace 的 openNewSessionMenuRef)。
 * 左栏收起时消费方未挂载:请求暂存 pending,注册 handler 时补派发一次。
 */

let handler: ((sessionId: string) => void) | null = null;
let pending: string | null = null;

/** 侧栏挂载期注册消费端(WorkspaceSection);返回退订函数。注册即补派发积压请求。 */
export function registerSessionRevealHandler(
  fn: (sessionId: string) => void,
): () => void {
  handler = fn;
  if (pending) {
    const id = pending;
    pending = null;
    fn(id);
  }
  return () => {
    if (handler === fn) handler = null;
  };
}

/** 顶栏发起定位:handler 在位直发,否则暂存待消费端挂载后补派发。 */
export function requestSessionReveal(sessionId: string): void {
  if (handler) handler(sessionId);
  else pending = sessionId;
}
