/**
 * 插件注册表组合件 —— 自 host.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:CLI profile 注册表、挂载点注册表、插件生命周期(激活编排/市场数据源)。
 * 自驱动注册通道(settingsRegistry/filePanel/tabs/fileVisual/shortcuts 等)
 * 不经此件,Host 直接委托模块函数(见 host.ts PluginContext 段)。
 */

import { PluginLifecycle } from "./pluginLifecycle";
import { registerQuotaProvider } from "./quota";
import { registerSidebarAction, type SidebarAction } from "./sidebarActions";
import { registerCommand } from "./shortcuts";
import type { CliProfile } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";

export class HostRegistry {
  private cliProfiles = new Map<string, CliProfile>();
  private mounts = new Map<MountPoint, MountContribution[]>();
  private lifecycle = new PluginLifecycle();

  /** notify:注册表内容变化后的外壳重渲染通知(Host.notify)。 */
  constructor(private readonly notify: () => void) {}

  registerCliProfile(profile: CliProfile): void {
    if (this.cliProfiles.has(profile.id)) {
      throw new Error(`CLI profile 重复注册: ${profile.id}`);
    }
    this.cliProfiles.set(profile.id, profile);
    /* quota 抓取器随 profile.fetchQuota 声明(同 listSuggestions 惯例),统一接线进 kernel/quota。 */
    if (profile.fetchQuota) {
      registerQuotaProvider({ profileId: profile.id, fetch: profile.fetchQuota });
    }
    this.notify();
  }

  contribute(point: MountPoint, contribution: MountContribution): void {
    const list = this.mounts.get(point) ?? [];
    list.push(contribution);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.mounts.set(point, list);
    this.notify();
  }

  /* 侧栏动作 → 无键位命令镜像(全量暴露进命令注册表,设置清单可见,为改键期
     备数据面)。内核不识业务语义:id/label/run 均取自 action 本身,属通用机制。
     键盘路径无真实点击锚点,给视口左下角作缺省锚点 —— 浮层类动作自带视口
     夹取定位(如 ProxyPopover),落点仍在左栏簇一带;非浮层动作本就忽略锚点。 */

  registerSidebarAction(action: SidebarAction): void {
    registerSidebarAction(action);
    registerCommand({
      id: `sidebar.${action.id}`,
      title: action.label,
      run: () => action.onSelect({ x: 8, y: window.innerHeight - 8 }),
    });
  }

  /** 插件激活编排(委托 kernel/pluginLifecycle);ctx 为 Host 自身(PluginContext)。 */
  activateAll(plugins: Plugin[], ctx: PluginContext): Promise<void> {
    return this.lifecycle.activateAll(plugins, ctx);
  }

  getCliProfiles(): CliProfile[] {
    return [...this.cliProfiles.values()];
  }

  getCliProfile(id: string): CliProfile | undefined {
    return this.cliProfiles.get(id);
  }

  getMount(point: MountPoint): MountContribution[] {
    return this.mounts.get(point) ?? [];
  }

  /** 插件市场数据源(委托 lifecycle)。 */
  listPluginStates(): { plugin: Plugin; enabled: boolean }[] {
    return this.lifecycle.listPluginStates();
  }

  /** 插件是否已激活(委托 lifecycle):拔插语义查询,门控应配合 dependsOn 声明。 */
  isPluginActive(id: string): boolean {
    return this.lifecycle.isPluginActive(id);
  }
}
