/**
 * 基础设置 / 快捷键 tab —— 全量命令清单的只读展示,零设置项。
 *
 * 数据源:@kernel/shortcuts 的 useCommands()(注册表快照,响应式)。
 * 分组:取命令 id 首段(第一个 . 之前)映射 host.listPluginStates() 的插件
 * meta.name 作组标题;映射不到插件的(shell/panel/action/terminal 等外壳
 * 自有前缀)统一归「外壳与终端」。样式复用 pref-card/pref-row 现有类。
 */

import { useMemo, useState } from "react";
import { formatKeybinding, useCommands, type CommandContribution } from "@kernel/shortcuts";
import { host } from "@kernel/host";

/** 前缀无法映射到任何插件 id 时的兜底组名。 */
const SHELL_GROUP_NAME = "外壳与终端";

interface CommandGroup {
  /** 组标题:插件显示名或外壳兜底名。 */
  name: string;
  /** 组内命令,保持注册表快照顺序(id 字典序)。 */
  commands: CommandContribution[];
}

/** 命令清单按 id 前缀分组;组按首次出现顺序(id 字典序)稳定排列。 */
export function groupCommandsByIdPrefix(
  commands: readonly CommandContribution[],
  nameByPluginId: ReadonlyMap<string, string>,
): CommandGroup[] {
  const groups = new Map<string, CommandGroup>();
  for (const cmd of commands) {
    const dot = cmd.id.indexOf(".");
    const prefix = dot === -1 ? cmd.id : cmd.id.slice(0, dot);
    const name = nameByPluginId.get(prefix) ?? SHELL_GROUP_NAME;
    let group = groups.get(name);
    if (!group) {
      group = { name, commands: [] };
      groups.set(name, group);
    }
    group.commands.push(cmd);
  }
  return [...groups.values()];
}

/** 键位展示标签:显式 label 优先,其次由 keybinding 推导,都没有 = 未绑定。 */
function keybindingText(cmd: CommandContribution): string | null {
  if (cmd.keybindingLabel) return cmd.keybindingLabel;
  if (cmd.keybinding) return formatKeybinding(cmd.keybinding);
  return null;
}

/** 清单渲染(纯展示,容器注入分组数据):每组一张 pref-card,组标题为卡片首行弱化字。 */
export function ShortcutGroups({ groups }: { groups: CommandGroup[] }) {
  return (
    <div data-testid="settings-shortcuts-card">
      {groups.map((group) => (
        <div key={group.name} className="pref-card">
          <div className="px-4 pt-3 pb-1 text-[11px] tracking-widest text-(--tmd-fg-faint)">
            {group.name}
          </div>
          {group.commands.map((cmd) => {
            const kb = keybindingText(cmd);
            return (
              <div key={cmd.id} className="pref-row">
                <div className="pref-title">{cmd.title}</div>
                {kb ? (
                  <span className="shrink-0 font-mono text-xs text-(--tmd-fg-muted)">
                    {kb}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-(--tmd-fg-faint)">未绑定</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ShortcutTab() {
  const commands = useCommands();
  /* 插件清单是启动态快照(activateAll 完成后不再变化),取一次即可。 */
  const [nameByPluginId] = useState(() => {
    const map = new Map<string, string>();
    for (const { plugin } of host.listPluginStates()) {
      map.set(plugin.id, plugin.meta.name);
    }
    return map;
  });

  const groups = useMemo(
    () => groupCommandsByIdPrefix(commands, nameByPluginId),
    [commands, nameByPluginId],
  );

  return <ShortcutGroups groups={groups} />;
}
