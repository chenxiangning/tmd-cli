/**
 * 插件生命周期 —— 注册表 + 激活编排 + 插件市场数据源。
 *
 * 从 host.ts 拆出(文件规模铁则 ≤300 行);Host 以组合方式持有,
 * activate 时把自身作为 PluginContext 传入,插件感知的宿主仍是 Host。
 *
 * 拔插语义(插件市场):activateAll 等 settings 首载后按 disabledPlugins 过滤,
 * 被拔出的插件不进入激活循环 —— 停用 = 重启后不激活,运行期不热卸载。
 */

import { getSettingsState, settingsReady } from "./settings";
import type { Plugin, PluginContext } from "./plugin";
import {
  makeAttributedCtx,
  pushCleanup,
  undoContributions,
  type ContributionUndo,
} from "./contributionLedger";
import { isQuarantined } from "./pluginQuarantine";

export class PluginLifecycle {
  private plugins = new Map<string, Plugin>();
  /** 并发闸：StrictMode 双调用会在首个 await 处交错，已激活过滤挡不住，必须共享同一个激活 Promise。 */
  private activation: Promise<void> | null = null;
  /** activateAll 传入的全量清单快照(含被禁用的),插件市场列表的数据源。 */
  private manifest: Plugin[] = [];
  /** 启动时被"拔出"(禁用)的插件 id 集合。 */
  private disabledPluginIds: ReadonlySet<string> = new Set();
  /** HostRegistry 撤销通道注入(激活失败回滚/熔断摘除走同一账本)。 */
  constructor(private readonly undo: ContributionUndo) {}

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
        try {
          const done = await plugin.activate(makeAttributedCtx(ctx, plugin, this.undo));
          if (typeof done === "function") pushCleanup(id, done);
        } catch (e) {
          undoContributions(id); // boot 链路同样零残留(原样上抛由调用方定夺)
          throw e;
        }
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

  /** 插件是否已激活(拔插 = 重启生效,运行期此态在 activateAll 后定格)。消费方据此做特性门控。 */
  isPluginActive(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * 晚激活(本地插件「待启用→确认」/重新扫描免重启通道):
   * 以首轮已激活集合为依赖底座;重复 id / 依赖缺失 / 被拔插件一律拒绝。
   * activate 抛错原样上抛(占位回滚),由晚激活调用方(boot 拓扑/重扫/确认)各自捕获隔离。
   * notify 由 HostRegistry 在调用成功后触发(与注册表变更同路径)。
   */
  async activateLate(plugin: Plugin, ctx: PluginContext): Promise<void> {
    await this.activation;
    if (isQuarantined(plugin.id)) throw new Error(`插件已熔断,重启后恢复: ${plugin.id}`);
    /* 同步占位防并发双激活(has 检查在 await 前的交错窗口会双双过闸,activate 跑两次=贡献双注册)。 */
    if (this.plugins.has(plugin.id)) throw new Error(`插件已激活: ${plugin.id}`);
    if (this.disabledPluginIds.has(plugin.id))
      throw new Error(`插件已拔出,重启后仍可恢复: ${plugin.id}`);
    const missing = (plugin.dependsOn ?? []).filter((d) => !this.plugins.has(d));
    if (missing.length > 0) throw new Error(`依赖缺失: ${missing.join(", ")}`);
    this.plugins.set(plugin.id, plugin);
    try {
      const done = await plugin.activate(makeAttributedCtx(ctx, plugin, this.undo));
      if (typeof done === "function") pushCleanup(plugin.id, done);
    } catch (e) {
      this.plugins.delete(plugin.id);
      undoContributions(plugin.id); // 贡献回滚:半截插件零残留(占位回滚之上补的一环)
      throw e;
    }
  }

  /** 熔断摘除(pluginQuarantine 阈值触发):撤销全部贡献并移出激活表;重启恢复。 */
  revoke(id: string): void {
    if (!this.plugins.delete(id)) return;
    undoContributions(id);
  }
}
