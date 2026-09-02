/**
 * 插件生命周期 —— 注册表 + 激活编排 + 插件市场数据源。
 *
 * 从 host.ts 拆出(文件规模铁则 ≤500 行);Host 以组合方式持有,
 * activate 时把自身作为 PluginContext 传入,插件感知的宿主仍是 Host。
 *
 * 拔插语义(插件市场):activateAll 等 settings 首载后按 disabledPlugins 过滤,
 * 被拔出的插件不进入激活循环 —— 停用 = 重启后不激活,运行期不热卸载。
 */

import { getSettingsState, settingsReady } from "./settings";
import type { Plugin, PluginContext } from "./plugin";

export class PluginLifecycle {
  private plugins = new Map<string, Plugin>();
  /** 并发闸：StrictMode 双调用会在首个 await 处交错，已激活过滤挡不住，必须共享同一个激活 Promise。 */
  private activation: Promise<void> | null = null;
  /** activateAll 传入的全量清单快照(含被禁用的),插件市场列表的数据源。 */
  private manifest: Plugin[] = [];
  /** 启动时被"拔出"(禁用)的插件 id 集合。 */
  private disabledPluginIds: ReadonlySet<string> = new Set();

  activateAll(plugins: Plugin[], ctx: PluginContext): Promise<void> {
    if (!this.activation) {
      this.activation = this.doActivateAll(plugins, ctx);
    }
    return this.activation;
  }

  private async doActivateAll(plugins: Plugin[], ctx: PluginContext): Promise<void> {
    /* 等 settings 首载:disabledPlugins 落盘值到了再过滤,否则过滤读的是默认值。 */
    await settingsReady;
    this.manifest = plugins;
    this.disabledPluginIds = new Set(getSettingsState().settings.disabledPlugins);
    /* 禁用插件不进激活循环;依赖被禁用者的 dependent 一并跳过(避免误抛依赖环)。
       现网无 dependsOn 使用,该收缩为防御性兜底。 */
    const activatable = new Set(plugins.map((p) => p.id));
    for (const p of plugins) {
      if (this.disabledPluginIds.has(p.id)) activatable.delete(p.id);
    }
    let shrinked = true;
    while (shrinked) {
      shrinked = false;
      for (const p of plugins) {
        if (!activatable.has(p.id)) continue;
        if ((p.dependsOn ?? []).some((d) => !activatable.has(d))) {
          activatable.delete(p.id);
          shrinked = true;
        }
      }
    }
    // 幂等：已激活的插件直接跳过（热更新场景）；
    // registerCliProfile 的重复检查仍然保留，用于拦截两个不同插件抢同一 id 的真冲突。
    const pending = new Map(
      plugins
        .filter((p) => activatable.has(p.id) && !this.plugins.has(p.id))
        .map((p) => [p.id, p]),
    );
    while (pending.size > 0) {
      let progressed = false;
      for (const [id, plugin] of pending) {
        const ready = (plugin.dependsOn ?? []).every((d) => this.plugins.has(d));
        if (!ready) continue;
        await plugin.activate(ctx);
        this.plugins.set(id, plugin);
        pending.delete(id);
        progressed = true;
      }
      if (!progressed) {
        throw new Error(`插件依赖环或缺失: ${[...pending.keys()].join(", ")}`);
      }
    }
  }

  /** 插件市场数据源:全量清单 × 启用态(join 自 manifest 与 disabledPluginIds)。 */
  listPluginStates(): { plugin: Plugin; enabled: boolean }[] {
    return this.manifest.map((plugin) => ({
      plugin,
      enabled: !this.disabledPluginIds.has(plugin.id),
    }));
  }
}
