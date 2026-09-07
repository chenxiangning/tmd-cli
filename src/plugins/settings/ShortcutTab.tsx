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
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";


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

/** 键帽芯片:对齐主流设置页的 keycap 视觉(描边圆角小块)。 */
function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex shrink-0 items-center rounded-[4px] border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-(--tmd-fg-muted)">
      {label}
    </kbd>
  );
}

/** 清单渲染(纯展示,容器注入分组数据):每组一张 pref-card,组标题行右侧计总数。 */
export function ShortcutGroups({ groups }: { groups: CommandGroup[] }) {
  return (
    <div data-testid="settings-shortcuts-card" className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.name} className="pref-card">
          <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
            <span className="text-[0.6875rem] tracking-widest text-(--tmd-fg-faint)">{t(group.name)}</span>
            <span className="text-[0.6875rem] text-(--tmd-fg-faint)">{group.commands.length}</span>
          </div>
          {group.commands.map((cmd) => {
            const kb = keybindingText(cmd);
            return (
              <div key={cmd.id} className="pref-row" title={cmd.id}>
                <div className="pref-title">{t(cmd.title)}</div>
                {kb ? (
                  <KeyCap label={kb} />
                ) : (
                  <span className="shrink-0 text-xs text-(--tmd-fg-faint)">{t("未绑定")}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 大小写不敏感匹配:标题 / 命令 id / 键位标签三者任一命中即保留。 */
export function filterCommands(
  groups: CommandGroup[],
  query: string,
): CommandGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const hit = (cmd: CommandContribution): boolean =>
    cmd.title.toLowerCase().includes(q) ||
    cmd.id.toLowerCase().includes(q) ||
    (keybindingText(cmd) ?? "").toLowerCase().includes(q);
  return groups
    .map((g) => ({ name: g.name, commands: g.commands.filter(hit) }))
    .filter((g) => g.commands.length > 0);
}

export function ShortcutTab() {
  const commands = useCommands();
  const [query, setQuery] = useState("");
  /* 插件清单是启动态快照(activateAll 完成后不再变化),取一次即可。 */
  const [nameByPluginId] = useState(() => {
    const map = new Map<string, string>();
    for (const { plugin } of host.listPluginStates()) {
      map.set(plugin.id, plugin.meta.name);
    }
    return map;
  });

  const groups = useMemo(() => {
    const all = groupCommandsByIdPrefix(commands, nameByPluginId);
    return filterCommands(all, query);
  }, [commands, nameByPluginId, query]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("搜索命令、键位或 id…")}
        className="h-8 w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-3 text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
      />
      {groups.length === 0 ? (
        <div className="pref-card px-4 py-6 text-center text-xs text-(--tmd-fg-faint)">
          {t("没有匹配的命令")}
        </div>
      ) : (
        <ShortcutGroups groups={groups} />
      )}
    </div>
  );
}
