/**
 * 工作台 · AI 直改 index.json 的自动感知:轮询磁盘原文指纹,变化才整载。
 * AI 会话按 AI-TASKS.md 直接回写任务 status/执行记录;此前这些回写只在手动
 * 「从磁盘同步」后才进内存(写前合并防冲掉见 workbenchFiles.mergeExternalEdits),
 * 这里让回写 ≤4s 自动进内存,UI 免手动刷新。独立成文件:store.ts 已顶 300 行铁则。
 */

import { reloadWorkbench } from "./store";
import { state } from "./storeCore";
import { readIndexRawIfChanged } from "./workbenchFiles";

/** 外部回写探测:原文与已知指纹一致即零动作;变化才整载(队列内串行,
 *  不嵌套 enqueue——reloadWorkbench 自身入队,在队列内调用会自死锁)。 */
export function reloadIfExternalChange(): Promise<void> {
  if (!state.loaded) return Promise.resolve();
  return readIndexRawIfChanged()
    .catch(() => null)
    .then((raw) => (raw === null ? undefined : reloadWorkbench()));
}

let watch: number | undefined;

/** 轮询装订(activate 调用;幂等)。裸 setInterval:tabContent 契约测试在无 window
 *  环境激活插件;浏览器句柄是 number,node 环境句柄类型不同但不参与 clear,收敛为 number。 */
export function startIndexWatch(): void {
  if (watch !== undefined) return;
  watch = setInterval(() => { void reloadIfExternalChange().catch(() => undefined); }, 4000) as unknown as number;
}
