/**
 * docgen 子域装配 —— 工作台 activate 调用:store 读档 → 队列恢复 →
 * 排程/生成体接线(退订随插件 deactivate)。
 */
import type { PluginContext } from "@kernel/plugin";
import { attachTaskPersistChannel, loadDocGen } from "./store";
import { restoreDocGenTasks } from "./queue";
import { bootDocGenSchedule } from "./schedule";
import "./docgen.css";

/** workbench.activate 调用;返回退订(停定时器/事件/生成体)。 */
export function attachDocGen(ctx: PluginContext): () => void {
  attachTaskPersistChannel();
  const ready = loadDocGen().then((tasks) => {
    restoreDocGenTasks(tasks);
  });
  return bootDocGenSchedule(ctx.events, ready);
}
