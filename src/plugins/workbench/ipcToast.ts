import { errTextDisplay } from "@kernel/errText";
/**
 * 工作台 · IPC 动作 toast 胶水(drawerTabs/DrawerDocsTab/TaskDetailView 三处
 * 逐字重复收敛至此):成功 toast okMessage,失败 toast 错误消息,恒 void。
 */

/** 成败都走 toast 的动作包装;返回 Promise<void>,调用方继续链式(如成功才清 dirty)。 */
export function runIpc(promise: Promise<unknown>, onToast: (m: string) => void, okMessage: string): Promise<void> {
  return promise.then(
    () => onToast(okMessage),
    (e) => onToast(errTextDisplay(e)),
  ).then(() => undefined);
}
