/**
 * 快捷键 tab 模型:命令分组 / 键位标签 / 搜索过滤,自 ShortcutList.tsx 拆出(only-export-components)。
 * 供 ShortcutTab(编排)与 ShortcutDetail(大键帽标签)复用。
 */
import { formatKeybinding, type CommandContribution } from "@kernel/shortcuts";
import { getShortcutOverridesSnapshot } from "@kernel/shortcutOverrides";

const SHELL_GROUP_NAME = "外壳与终端";

export interface CommandGroup {
  name: string;
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

/** effective 键位展示标签:label > effective keybinding > 未绑定(null)。 */
export function effectiveLabel(cmd: CommandContribution): string | null {
  const overrides = getShortcutOverridesSnapshot();
  const overridden = overrides[cmd.id];
  if (overridden === "") return null;
  if (overridden !== undefined) return formatKeybinding(overridden);
  if (cmd.keybindingLabel) return cmd.keybindingLabel;
  if (cmd.keybinding) return formatKeybinding(cmd.keybinding);
  return null;
}

/** 大小写不敏感匹配:标题 / 命令 id / 键位标签三者任一命中即保留。 */
export function filterCommands(
  groups: CommandGroup[],
  query: string,
): CommandGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const hit = (cmd: CommandContribution): boolean => {
    const label = effectiveLabel(cmd) ?? "";
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q) ||
      label.toLowerCase().includes(q)
    );
  };
  // 单趟 flatMap 保序:空组丢弃(原先 map 后 filter 的两趟写法)
  return groups.flatMap((g) => {
    const commands = g.commands.filter(hit);
    return commands.length > 0 ? [{ name: g.name, commands }] : [];
  });
}
